defmodule BackendWeb.ChatChannel do
  use Phoenix.Channel

  alias Backend.Chat
  alias Backend.Servers
  alias Backend.Presence

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
        errors = Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
          Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
            opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
          end)
        end)
        {:reply, {:error, %{errors: errors}}, socket}
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
      username: message.user && message.user.username,
      inserted_at: message.inserted_at
    }
  end
end
