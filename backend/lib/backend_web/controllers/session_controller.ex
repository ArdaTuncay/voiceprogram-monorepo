defmodule BackendWeb.SessionController do
  @moduledoc """
  The signed-in user's active sessions (see `Backend.Accounts.Session`):
  list them, sign one out, or sign out this one.
  """
  use BackendWeb, :controller

  alias Backend.Accounts

  @doc "GET /api/account/sessions — most recently active first; `current` marks this one."
  def index(conn, _params) do
    current = conn.assigns.current_session_id

    sessions =
      conn.assigns.current_user
      |> Accounts.list_sessions()
      |> Enum.map(fn session ->
        %{
          id: session.id,
          user_agent: session.user_agent,
          ip: session.ip,
          created_at: session.inserted_at,
          last_seen_at: session.last_seen_at,
          current: session.id == current
        }
      end)

    json(conn, sessions)
  end

  @doc "DELETE /api/account/sessions/:id — signs that session out (its sockets drop too)."
  def delete(conn, %{"id" => id}) do
    case Accounts.revoke_session(conn.assigns.current_user, id) do
      :ok ->
        send_resp(conn, :no_content, "")

      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: gettext("Session not found")})
    end
  end

  @doc """
  POST /api/users/logout — ends this session on the server, so the token
  the browser is about to forget can't be used by anyone who copied it.
  """
  def logout(conn, _params) do
    case conn.assigns.current_session_id do
      nil -> :ok
      id -> Accounts.revoke_session(conn.assigns.current_user, id)
    end

    send_resp(conn, :no_content, "")
  end
end
