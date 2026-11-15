defmodule BackendWeb.BanController do
  @moduledoc """
  Server bans, for the owner and moderators: `GET/POST /api/servers/:server_id/bans`,
  `DELETE /api/servers/:server_id/bans/:user_id`. A moderator can only ban
  regular members (or non-members) — see `Backend.Servers.can_moderate?/3`
  and `Backend.Servers.ban_user/4`.
  """
  use BackendWeb, :controller

  alias Backend.Accounts
  alias Backend.Servers
  alias Backend.Servers.Server

  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 20, key: :current_user]
       when action in [:create, :delete]

  def index(conn, %{"server_id" => server_id}) do
    with_moderated_server(conn, server_id, fn server ->
      json(conn, Servers.list_bans(server.id))
    end)
  end

  def create(conn, %{"server_id" => server_id, "user_id" => user_id} = params)
      when is_binary(user_id) do
    with_moderated_server(conn, server_id, fn server ->
      with {:ok, _} <- Ecto.UUID.cast(user_id),
           %{} <- Accounts.get_user(user_id) do
        ban(conn, server, user_id, params["reason"])
      else
        _ -> conn |> put_status(:not_found) |> json(%{error: "Kullanıcı bulunamadı"})
      end
    end)
  end

  def create(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "user_id gerekli"})
  end

  def delete(conn, %{"server_id" => server_id, "user_id" => user_id}) do
    with_moderated_server(conn, server_id, fn server ->
      case Servers.unban_user(server.id, user_id) do
        {:ok, _} -> send_resp(conn, :no_content, "")
        {:error, _} -> conn |> put_status(:not_found) |> json(%{error: "Yasak bulunamadı"})
      end
    end)
  end

  defp ban(conn, server, user_id, reason) do
    actor_id = conn.assigns.current_user.id

    if user_id == server.owner_id or Servers.can_moderate?(server.id, actor_id, user_id) do
      do_ban(conn, server, user_id, reason)
    else
      conn |> put_status(:forbidden) |> json(%{error: "Bu kullanıcıyı yasaklayamazsın"})
    end
  end

  defp do_ban(conn, server, user_id, reason) do
    case Servers.ban_user(server, user_id, conn.assigns.current_user.id, reason) do
      {:ok, ban} ->
        conn
        |> put_status(:created)
        |> json(%{user_id: ban.user_id, reason: ban.reason, banned_at: ban.inserted_at})

      {:error, :owner} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Sunucu sahibi yasaklanamaz"})

      {:error, %Ecto.Changeset{} = changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  defp with_moderated_server(conn, server_id, fun) do
    case Servers.get_server(server_id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Server not found"})

      %Server{} = server ->
        if Servers.moderator?(server.id, conn.assigns.current_user.id) do
          fun.(server)
        else
          conn |> put_status(:forbidden) |> json(%{error: "Forbidden"})
        end
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
