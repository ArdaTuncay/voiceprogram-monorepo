defmodule BackendWeb.DmController do
  use BackendWeb, :controller

  alias Backend.DirectMessages
  alias Backend.DirectMessages.DmRoom

  @doc "GET /api/dms — lists every DM room the current user is part of."
  def index(conn, _params) do
    json(conn, DirectMessages.list_rooms_for_user(conn.assigns.current_user.id))
  end

  @doc """
  GET /api/dms/:room_id/messages — returns the most recent 50 messages, or
  (with a `before` query param set to a message id) the 50 messages
  immediately preceding it, for infinite-scroll paging.
  """
  def messages(conn, %{"room_id" => room_id} = params) do
    user_id = conn.assigns.current_user.id

    case DirectMessages.get_room(room_id) do
      %DmRoom{} = room ->
        if DirectMessages.member?(room, user_id) do
          messages = DirectMessages.list_messages(room.id, before_id: params["before"])

          json(conn, %{
            messages: Enum.map(messages, &message_json/1),
            has_more: length(messages) >= 50
          })
        else
          conn |> put_status(:not_found) |> json(%{error: "DM room not found"})
        end

      nil ->
        conn |> put_status(:not_found) |> json(%{error: "DM room not found"})
    end
  end

  @doc """
  GET /api/dm_rooms/:dm_room_id/search — full-text search over a DM room's
  message history. Accepts optional `query`, `author_id`, and `has_file`
  query params; requires the caller to be a participant in the room.
  """
  def search(conn, %{"dm_room_id" => room_id} = params) do
    user_id = conn.assigns.current_user.id

    case DirectMessages.get_room(room_id) do
      %DmRoom{} = room ->
        if DirectMessages.member?(room, user_id) do
          messages = DirectMessages.search_dm_messages(room.id, params)
          json(conn, %{messages: Enum.map(messages, &message_json/1)})
        else
          conn |> put_status(:not_found) |> json(%{error: "DM room not found"})
        end

      nil ->
        conn |> put_status(:not_found) |> json(%{error: "DM room not found"})
    end
  end

  @doc "POST /api/dms — opens (or returns the existing) DM room with a friend, by \"user_id\"."
  def create(conn, params) do
    user_id = conn.assigns.current_user.id

    case DirectMessages.open_room(user_id, params) do
      {:ok, room} ->
        conn
        |> put_status(:created)
        |> json(DirectMessages.to_view(room, user_id))

      {:error, :user_not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "Kullanıcı bulunamadı"})

      {:error, :cannot_dm_self} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Kendinize mesaj gönderemezsiniz"})

      {:error, :not_friends} ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "Sadece arkadaşlarınıza mesaj gönderebilirsiniz"})

      {:error, %Ecto.Changeset{} = changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end

  defp message_json(message) do
    %{
      id: message.id,
      content: message.content,
      file_url: message.file_url,
      file_type: message.file_type,
      user_id: message.user_id,
      username: message.user && message.user.username,
      inserted_at: message.inserted_at,
      reactions: message.reactions
    }
  end
end
