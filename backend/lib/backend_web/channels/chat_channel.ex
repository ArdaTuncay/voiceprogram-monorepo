defmodule BackendWeb.ChatChannel do
  @moduledoc """
  Realtime channel for a server's text channel — join validates the socket's
  user is a member of the channel's server, then relays chat
  messages/typing/reactions and fans out "new_message" notifications to
  every other member's personal topic (see `notify_other_members/3`).
  """

  use Phoenix.Channel

  alias Backend.Chat
  alias Backend.Presence
  alias Backend.Servers
  alias BackendWeb.ChannelRateLimiter

  # "shout": ~human typing speed multiplied several times over, not a hard
  # per-message-content check — flags flood/script traffic without
  # throttling a fast typist.
  @shout_scale :timer.seconds(10)
  @shout_limit 15

  # "update_message": editing is a rarer action than sending, so a tighter
  # per-minute budget doesn't cost real users anything.
  @update_message_scale :timer.minutes(1)
  @update_message_limit 10

  # "toggle_reaction": one tap per emoji, but users legitimately toggle
  # several reactions in a row while scrolling a busy channel.
  @toggle_reaction_scale :timer.minutes(1)
  @toggle_reaction_limit 30

  # "delete_message": same rarity/budget reasoning as "update_message".
  @delete_message_scale :timer.minutes(1)
  @delete_message_limit 10

  @impl true
  def join("chat:" <> channel_id, _params, socket) do
    case Chat.get_channel(channel_id) do
      nil ->
        {:error, %{reason: "channel not found"}}

      channel ->
        if Servers.member?(channel.server_id, socket.assigns.user_id) do
          messages = Chat.list_messages(channel.id) |> Enum.map(&serialize_message/1)

          socket =
            socket
            |> assign(:channel_id, channel.id)
            |> assign(:channel_name, channel.name)
            |> assign(:server_id, channel.server_id)

          send(self(), :after_join)

          {:ok, %{messages: messages}, socket}
        else
          {:error, %{reason: "not authorized"}}
        end
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    {:ok, _} =
      Presence.track(socket, socket.assigns.user_id, %{
        username: socket.assigns.username,
        online_at: System.system_time(:second)
      })

    push(socket, "presence_state", Presence.list(socket))

    {:noreply, socket}
  end

  @impl true
  def handle_in("shout", params, socket) do
    key = {:chat, "shout", socket.assigns.channel_id, socket.assigns.user_id}

    if ChannelRateLimiter.limited?(
         key,
         @shout_scale,
         @shout_limit,
         socket.assigns.user_id,
         "chat_shout"
       ) do
      {:reply, {:error, %{reason: "rate_limited"}}, socket}
    else
      attrs = %{
        content: Map.get(params, "content", ""),
        file_url: Map.get(params, "file_url"),
        file_type: Map.get(params, "file_type"),
        user_id: socket.assigns.user_id,
        channel_id: socket.assigns.channel_id
      }

      case Chat.create_message(attrs) do
        {:ok, message} ->
          serialized = serialize_message(message)
          broadcast!(socket, "shout", serialized)
          notify_other_members(socket, message, serialized)
          {:reply, :ok, socket}

        {:error, changeset} ->
          {:reply, {:error, %{errors: format_errors(changeset)}}, socket}
      end
    end
  end

  @impl true
  def handle_in("update_message", %{"message_id" => message_id, "content" => content}, socket) do
    key = {:chat, "update_message", socket.assigns.channel_id, socket.assigns.user_id}

    if ChannelRateLimiter.limited?(
         key,
         @update_message_scale,
         @update_message_limit,
         socket.assigns.user_id,
         "chat_update_message"
       ) do
      {:reply, {:error, %{reason: "rate_limited"}}, socket}
    else
      attrs = %{
        content: content,
        user_id: socket.assigns.user_id,
        channel_id: socket.assigns.channel_id
      }

      case Chat.update_message(message_id, attrs) do
        {:ok, message} ->
          broadcast!(socket, "message_updated", serialize_message(message))
          {:reply, :ok, socket}

        {:error, :not_found} ->
          {:reply, {:error, %{reason: "message not found"}}, socket}

        {:error, :not_authorized} ->
          {:reply, {:error, %{reason: "not authorized"}}, socket}

        {:error, changeset} ->
          {:reply, {:error, %{errors: format_errors(changeset)}}, socket}
      end
    end
  end

  @impl true
  def handle_in("delete_message", %{"message_id" => message_id}, socket) do
    key = {:chat, "delete_message", socket.assigns.channel_id, socket.assigns.user_id}

    if ChannelRateLimiter.limited?(
         key,
         @delete_message_scale,
         @delete_message_limit,
         socket.assigns.user_id,
         "chat_delete_message"
       ) do
      {:reply, {:error, %{reason: "rate_limited"}}, socket}
    else
      attrs = %{user_id: socket.assigns.user_id, channel_id: socket.assigns.channel_id}

      case Chat.delete_message(message_id, attrs) do
        {:ok, message} ->
          broadcast!(socket, "message_deleted", serialize_message(message))
          {:reply, :ok, socket}

        {:error, :not_found} ->
          {:reply, {:error, %{reason: "message not found"}}, socket}

        {:error, :not_authorized} ->
          {:reply, {:error, %{reason: "not authorized"}}, socket}

        {:error, changeset} ->
          {:reply, {:error, %{errors: format_errors(changeset)}}, socket}
      end
    end
  end

  @impl true
  def handle_in("typing", %{"is_typing" => is_typing}, socket) do
    broadcast_from!(socket, "user_typing", %{
      user_id: socket.assigns.user_id,
      username: socket.assigns.username,
      is_typing: is_typing
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("toggle_reaction", %{"message_id" => message_id, "emoji" => emoji}, socket) do
    key = {:chat, "toggle_reaction", socket.assigns.channel_id, socket.assigns.user_id}

    if ChannelRateLimiter.limited?(
         key,
         @toggle_reaction_scale,
         @toggle_reaction_limit,
         socket.assigns.user_id,
         "chat_toggle_reaction"
       ) do
      {:reply, {:error, %{reason: "rate_limited"}}, socket}
    else
      case Chat.toggle_reaction(
             message_id,
             socket.assigns.channel_id,
             socket.assigns.user_id,
             emoji
           ) do
        {:ok, reactions} ->
          broadcast!(socket, "reaction_toggled", %{message_id: message_id, reactions: reactions})
          {:reply, :ok, socket}

        {:error, reason} ->
          {:reply, {:error, %{reason: to_string(reason)}}, socket}
      end
    end
  end

  # Lets every other server member know a message landed, even if they aren't
  # viewing this channel right now — their personal "user:<id>" channel is
  # how Chat.tsx drives desktop notifications and unread badges for channels
  # they don't currently have open.
  defp notify_other_members(socket, message, serialized) do
    payload =
      Map.merge(serialized, %{
        channel_id: socket.assigns.channel_id,
        channel_name: socket.assigns.channel_name,
        server_id: socket.assigns.server_id
      })

    socket.assigns.server_id
    |> Servers.list_member_user_ids()
    |> Enum.reject(&(&1 == message.user_id))
    |> Enum.each(fn member_id ->
      BackendWeb.Endpoint.broadcast("user:#{member_id}", "new_message", payload)
    end)
  end

  defp serialize_message(message) do
    %{
      id: message.id,
      content: message.content,
      file_url: message.file_url,
      file_type: message.file_type,
      user_id: message.user_id,
      username: Backend.Accounts.display_username(message.user),
      inserted_at: message.inserted_at,
      is_edited: message.is_edited,
      reactions: message.reactions,
      # content/file_url/file_type are already nil by this point for a
      # deleted message (see Message.delete_changeset/1) — this just gives
      # the frontend an explicit signal to render its "message deleted"
      # placeholder instead of an oddly-empty message.
      is_deleted: !is_nil(message.deleted_at)
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
