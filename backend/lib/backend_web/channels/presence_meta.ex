defmodule BackendWeb.PresenceMeta do
  @moduledoc """
  The Presence metadata every channel tracks for a user: who they are and
  what picture to show for them. The online list, the voice room and the
  voice-occupant preview all render from this, so it has to carry the
  avatar, not just the username.
  """

  alias Backend.Accounts

  @doc "The base metadata for the socket's user, plus any channel-specific `extra` fields."
  @spec for_socket(Phoenix.Socket.t(), map()) :: map()
  def for_socket(socket, extra \\ %{}) do
    Map.merge(
      %{
        username: socket.assigns.username,
        avatar_url: Accounts.get_avatar_url(socket.assigns.user_id),
        online_at: System.system_time(:second)
      },
      extra
    )
  end
end
