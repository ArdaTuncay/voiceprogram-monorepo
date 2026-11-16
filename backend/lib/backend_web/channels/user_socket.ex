defmodule BackendWeb.UserSocket do
  use Phoenix.Socket

  alias Backend.Accounts

  channel "chat:*", BackendWeb.ChatChannel
  channel "voice:*", BackendWeb.VoiceChannel
  channel "user:*", BackendWeb.UserChannel
  channel "dm:*", BackendWeb.DmChannel
  channel "server:*", BackendWeb.ServerChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Accounts.authenticate_session(token) do
      {:ok, user, session_id} ->
        socket =
          socket
          |> assign(:user_id, user.id)
          |> assign(:username, user.username)
          |> assign(:session_id, session_id)

        {:ok, socket}

      {:error, _} ->
        :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  # Per session, so signing out one device drops exactly its sockets (see
  # Backend.Accounts.revoke_session/2); per user for a token from before
  # sessions existed. Backend.Accounts.end_all_sessions/1 covers both.
  def id(%{assigns: %{session_id: id}}) when is_binary(id), do: "user_socket:session:#{id}"
  def id(socket), do: "user_socket:#{socket.assigns.user_id}"
end
