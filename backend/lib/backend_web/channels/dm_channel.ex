defmodule BackendWeb.DmChannel do
  @moduledoc """
  Realtime channel for a single direct-message room — join validates the
  socket's user is one of the room's two participants, then relays chat
  messages/typing/reactions the same way `BackendWeb.ChatChannel` does for
  server channels.
  """

  use Phoenix.Channel

  alias Backend.DirectMessages
  alias Backend.Friends
  alias Backend.Presence
  alias BackendWeb.ChannelRateLimiter

  # See BackendWeb.ChatChannel for the reasoning behind these limits — DMs
  # use the same values since it's the same "shout"/"update_message"/
  # "toggle_reaction" trio, just scoped to a room instead of a channel.
  @shout_scale :timer.seconds(10)
  @shout_limit 15

  @update_message_scale :timer.minutes(1)
  @update_message_limit 10

  @toggle_reaction_scale :timer.minutes(1)
  @toggle_reaction_limit 30

  @impl true
  def join("dm:" <> room_id, _params, socket) do
    case DirectMessages.get_room(room_id) do
      nil ->
        {:error, %{reason: "room not found"}}

      room ->
        if DirectMessages.member?(room, socket.assigns.user_id) do
          messages = room.id |> DirectMessages.list_messages() |> Enum.map(&serialize_message/1)

          other_user_id =
            if room.user_one_id == socket.assigns.user_id,
              do: room.user_two_id,
              else: room.user_one_id

          socket =
            socket
            |> assign(:room_id, room.id)
            |> assign(:other_user_id, other_user_id)

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
    # Checked before the rate limiter, not after — a blocked sender
    # shouldn't be able to tell the two failure modes apart by which one
    # fires first, and there's no reason to spend a rate-limit hit on a
    # message that was never going anywhere. Room history/join stays
    # untouched either way (see BackendWeb.DmChannel's moduledoc) — this
    # only stops a *new* message, mirroring
    # Backend.DirectMessages.open_room/2's own block check for opening a
    # room in the first place.
    if Friends.blocked_either_way?(socket.assigns.user_id, socket.assigns.other_user_id) do
      {:reply, {:error, %{reason: "blocked"}}, socket}
    else
      handle_shout(params, socket)
    end
  end

  @impl true
  def handle_in("update_message", %{"message_id" => message_id, "content" => content}, socket) do
    key = {:dm, "update_message", socket.assigns.room_id, socket.assigns.user_id}

    if ChannelRateLimiter.limited?(
         key,
         @update_message_scale,
         @update_message_limit,
         socket.assigns.user_id,
         "dm_update_message"
       ) do
      {:reply, {:error, %{reason: "rate_limited"}}, socket}
    else
      attrs = %{
        content: content,
        user_id: socket.assigns.user_id,
        dm_room_id: socket.assigns.room_id
      }

      case DirectMessages.update_dm_message(message_id, attrs) do
        {:ok, message} ->
          broadcast!(socket, "dm_message_updated", serialize_message(message))
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
    key = {:dm, "toggle_reaction", socket.assigns.room_id, socket.assigns.user_id}

    if ChannelRateLimiter.limited?(
         key,
         @toggle_reaction_scale,
         @toggle_reaction_limit,
         socket.assigns.user_id,
         "dm_toggle_reaction"
       ) do
      {:reply, {:error, %{reason: "rate_limited"}}, socket}
    else
      case DirectMessages.toggle_reaction(
             message_id,
             socket.assigns.room_id,
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

  defp handle_shout(params, socket) do
    key = {:dm, "shout", socket.assigns.room_id, socket.assigns.user_id}

    if ChannelRateLimiter.limited?(
         key,
         @shout_scale,
         @shout_limit,
         socket.assigns.user_id,
         "dm_shout"
       ) do
      {:reply, {:error, %{reason: "rate_limited"}}, socket}
    else
      attrs = %{
        content: Map.get(params, "content", ""),
        file_url: Map.get(params, "file_url"),
        file_type: Map.get(params, "file_type"),
        user_id: socket.assigns.user_id,
        dm_room_id: socket.assigns.room_id
      }

      case DirectMessages.create_message(attrs) do
        {:ok, message} ->
          serialized = serialize_message(message)
          broadcast!(socket, "shout", serialized)
          notify_other_participant(socket, serialized)
          {:reply, :ok, socket}

        {:error, changeset} ->
          {:reply, {:error, %{errors: format_errors(changeset)}}, socket}
      end
    end
  end

  # Lets the other participant know a message landed even if they aren't
  # viewing this DM right now — mirrors ChatChannel's notify_other_members/3,
  # via the same personal "user:<id>" topic (no separate DM notification
  # channel needed).
  defp notify_other_participant(socket, serialized) do
    payload = Map.put(serialized, :dm_room_id, socket.assigns.room_id)

    BackendWeb.Endpoint.broadcast(
      "user:#{socket.assigns.other_user_id}",
      "new_dm_message",
      payload
    )
  end

  defp serialize_message(message) do
    %{
      id: message.id,
      content: message.content,
      file_url: message.file_url,
      file_type: message.file_type,
      user_id: message.user_id,
      username: message.user && message.user.username,
      inserted_at: message.inserted_at,
      is_edited: message.is_edited,
      reactions: message.reactions
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
