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
    case Accounts.authenticate_token(token) do
      {:ok, user} ->
        socket =
          socket
          |> assign(:user_id, user.id)
          |> assign(:username, user.username)

        {:ok, socket}

      {:error, _} ->
        :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.user_id}"
end
