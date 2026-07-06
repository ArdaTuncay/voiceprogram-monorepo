defmodule BackendWeb.ChannelController do
  use BackendWeb, :controller

  alias Backend.Chat
  alias Backend.Chat.Channel
  alias Backend.Servers

  @doc "DELETE /api/channels/:id — permanently deletes a text or voice channel. Server owner only."
  def delete(conn, %{"id" => channel_id}) do
    with %Channel{} = channel <- Chat.get_channel(channel_id),
         true <- Servers.owner?(channel.server_id, conn.assigns.current_user.id) do
      {:ok, _} = Servers.delete_channel(channel)
      send_resp(conn, :no_content, "")
    else
      false ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "Only the server owner can perform this action"})

      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Channel not found"})
    end
  end
end
