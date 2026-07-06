defmodule BackendWeb.UserChannel do
  use Phoenix.Channel

  # A user's personal notification topic — used to relay "new_message" events
  # (see ChatChannel) for channels the user isn't currently viewing. Only the
  # authenticated owner of this id may join it.
  @impl true
  def join("user:" <> user_id, _params, socket) do
    if user_id == socket.assigns.user_id do
      {:ok, socket}
    else
      {:error, %{reason: "not authorized"}}
    end
  end
end
