defmodule BackendWeb.ChannelController do
  use BackendWeb, :controller

  alias Backend.Chat
  alias Backend.Chat.Channel
  alias Backend.Servers

  @doc """
  GET /api/servers/:server_id/channels/:channel_id/messages — returns the
  most recent 50 messages, or (with a `before` query param set to a message
  id) the 50 messages immediately preceding it, for infinite-scroll paging.
  """
  def messages(conn, %{"server_id" => server_id, "channel_id" => channel_id} = params) do
    with %Channel{} = channel <- Chat.get_channel(channel_id),
         true <- channel.server_id == server_id,
         true <- Servers.member?(channel.server_id, conn.assigns.current_user.id) do
      messages = Chat.list_messages(channel.id, before_id: params["before"])

      json(conn, %{
        messages: Enum.map(messages, &message_json/1),
        has_more: length(messages) >= 50
      })
    else
      _ ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Channel not found"})
    end
  end

  @doc """
  GET /api/channels/:channel_id/search — full-text search over a channel's
  message history. Accepts optional `query`, `author_id`, and `has_file`
  query params; requires the caller to be a member of the channel's server.
  """
  def search(conn, %{"channel_id" => channel_id} = params) do
    with %Channel{} = channel <- Chat.get_channel(channel_id),
         true <- Servers.member?(channel.server_id, conn.assigns.current_user.id) do
      messages = Chat.search_messages(channel.id, params)
      json(conn, %{messages: Enum.map(messages, &message_json/1)})
    else
      _ ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Channel not found"})
    end
  end

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

  defp message_json(message) do
    %{
      id: message.id,
      content: message.content,
      file_url: message.file_url,
      file_type: message.file_type,
      user_id: message.user_id,
      username: Backend.Accounts.display_username(message.user),
      inserted_at: message.inserted_at,
      reactions: message.reactions,
      # See BackendWeb.ChatChannel's serialize_message/1 for why this
      # needs to travel with every message shape, not just the channel's.
      is_deleted: !is_nil(message.deleted_at)
    }
  end
end
