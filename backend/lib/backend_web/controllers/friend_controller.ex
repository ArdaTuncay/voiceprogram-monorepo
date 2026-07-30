defmodule BackendWeb.FriendController do
  use BackendWeb, :controller

  alias Backend.Friends

  # Anti-spam/enumeration guard — keyed by the authenticated caller (see
  # BackendWeb.RateLimiterPlug), not by the target "username"/"user_id"
  # being probed, so rotating targets from one account doesn't dodge it.
  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 20, key: :current_user] when action in [:request]

  @doc "GET /api/friends — lists every friendship/request involving the current user."
  def index(conn, _params) do
    json(conn, Friends.list_friendships_for_user(conn.assigns.current_user.id))
  end

  @doc ~s(POST /api/friends/request — sends a friend request, by "username" or "user_id".)
  def request(conn, params) do
    user_id = conn.assigns.current_user.id

    case Friends.send_request(user_id, params) do
      {:ok, friendship} ->
        conn
        |> put_status(:created)
        |> json(Friends.to_view(friendship, user_id))

      {:error, reason} ->
        render_request_error(conn, reason)
    end
  end

  # Split out of request/2 purely to keep its own cyclomatic complexity
  # down — each clause here is a trivial one-liner, request/2 itself is
  # just the ok/error split.
  defp render_request_error(conn, :user_not_found) do
    conn |> put_status(:not_found) |> json(%{error: "Kullanıcı bulunamadı"})
  end

  defp render_request_error(conn, :cannot_friend_self) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "Kendinize arkadaşlık isteği gönderemezsiniz"})
  end

  defp render_request_error(conn, :already_pending) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "Zaten bekleyen bir isteğiniz var"})
  end

  defp render_request_error(conn, :already_friends) do
    conn |> put_status(:unprocessable_entity) |> json(%{error: "Zaten arkadaşsınız"})
  end

  defp render_request_error(conn, :blocked_by_you) do
    conn |> put_status(:unprocessable_entity) |> json(%{error: "Bu kullanıcıyı engellediniz"})
  end

  defp render_request_error(conn, :blocked_by_them) do
    conn |> put_status(:unprocessable_entity) |> json(%{error: "Bu istek gönderilemedi"})
  end

  defp render_request_error(conn, :requests_disabled) do
    conn
    |> put_status(:forbidden)
    |> json(%{error: "Bu kullanıcı arkadaşlık isteklerini kapatmış"})
  end

  defp render_request_error(conn, %Ecto.Changeset{} = changeset) do
    conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
  end

  @doc "POST /api/friends/accept — accepts a pending request by its friendship \"id\"."
  def accept(conn, %{"id" => id}) do
    user_id = conn.assigns.current_user.id

    case Friends.accept_request(user_id, id) do
      {:ok, friendship} ->
        json(conn, Friends.to_view(friendship, user_id))

      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "İstek bulunamadı"})

      {:error, :not_authorized} ->
        conn |> put_status(:forbidden) |> json(%{error: "Bu isteği kabul edemezsiniz"})

      {:error, :invalid_state} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Bu istek zaten işlenmiş"})
    end
  end

  def accept(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "id gerekli"})
  end

  @doc "DELETE /api/friends/:id — cancels/rejects a request, or removes an existing friendship."
  def delete(conn, %{"id" => id}) do
    case Friends.remove_friendship(conn.assigns.current_user.id, id) do
      {:ok, _} ->
        send_resp(conn, :no_content, "")

      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "Kayıt bulunamadı"})

      {:error, :not_authorized} ->
        conn |> put_status(:forbidden) |> json(%{error: "Bu işlemi yapamazsınız"})
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
