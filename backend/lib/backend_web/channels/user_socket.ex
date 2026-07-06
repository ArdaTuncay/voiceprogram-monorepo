defmodule BackendWeb.UserSocket do
  use Phoenix.Socket

  alias Backend.Accounts
  alias Backend.Accounts.User

  channel "chat:*", BackendWeb.ChatChannel
  channel "voice:*", BackendWeb.VoiceChannel
  channel "user:*", BackendWeb.UserChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    with {:ok, user_id} <- Accounts.verify_user_token(token),
         %User{} = user <- Accounts.get_user(user_id) do
      socket =
        socket
        |> assign(:user_id, user.id)
        |> assign(:username, user.username)

      {:ok, socket}
    else
      _ -> :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.user_id}"
end
