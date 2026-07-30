defmodule BackendWeb.BlockController do
  use BackendWeb, :controller

  alias Backend.Friends

  # Anti-abuse guard — keyed by the authenticated caller (see
  # BackendWeb.RateLimiterPlug), same reasoning as AccountController's:
  # there's no "target" worth keying on here either, blocking/unblocking
  # your own list shouldn't happen more than a handful of times a minute.
  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 10, key: :current_user]
       when action in [:create, :delete]

  @doc "POST /api/users/:id/block"
  def create(conn, %{"id" => blocked_id}) do
    case Friends.block_user(conn.assigns.current_user.id, blocked_id) do
      {:ok, _friendship} ->
        send_resp(conn, :no_content, "")

      {:error, :cannot_block_self} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Kendinizi engelleyemezsiniz"})

      {:error, :user_not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "Kullanıcı bulunamadı"})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  @doc "DELETE /api/users/:id/block"
  def delete(conn, %{"id" => blocked_id}) do
    case Friends.unblock_user(conn.assigns.current_user.id, blocked_id) do
      {:ok, _friendship} ->
        send_resp(conn, :no_content, "")

      {:error, :not_blocked} ->
        conn |> put_status(:not_found) |> json(%{error: "Bu kullanıcıyı engellemediniz"})
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
