defmodule BackendWeb.ReportController do
  @moduledoc """
  Message reports — see `Backend.Reports`.

    * `POST /api/reports` with `message_id` or `dm_message_id`, `reason`
      and optional `details`: any user, for a message they can see.
    * `GET /api/servers/:server_id/reports`: the server's open reports,
      for its owner and moderators.
    * `PATCH /api/servers/:server_id/reports/:id` with `status`
      (`"resolved"` or `"dismissed"`): owner and moderators.
  """
  use BackendWeb, :controller

  alias Backend.{Accounts, Reports, Servers}
  alias Backend.Servers.Server

  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 10, key: :current_user]
       when action in [:create]

  def create(conn, %{"message_id" => id} = params) when is_binary(id) do
    respond_created(conn, Reports.report_message(conn.assigns.current_user.id, id, params))
  end

  def create(conn, %{"dm_message_id" => id} = params) when is_binary(id) do
    respond_created(conn, Reports.report_dm_message(conn.assigns.current_user.id, id, params))
  end

  def create(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "message_id veya dm_message_id gerekli"})
  end

  def index(conn, %{"server_id" => server_id}) do
    with_staff(conn, server_id, fn server ->
      json(conn, Enum.map(Reports.list_server_reports(server.id), &report_json/1))
    end)
  end

  def update(conn, %{"server_id" => server_id, "id" => id} = params) do
    with_staff(conn, server_id, fn server ->
      case Reports.review_report(server.id, id, conn.assigns.current_user.id, params["status"]) do
        {:ok, report} ->
          json(conn, %{id: report.id, status: report.status})

        {:error, :not_found} ->
          conn |> put_status(:not_found) |> json(%{error: gettext("Report not found")})

        {:error, _} ->
          conn |> put_status(:unprocessable_entity) |> json(%{error: gettext("Invalid status")})
      end
    end)
  end

  defp respond_created(conn, result) do
    case result do
      {:ok, report} ->
        conn |> put_status(:created) |> json(%{id: report.id})

      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: gettext("Message not found")})

      {:error, :own_message} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: gettext("You can't report your own message")})

      {:error, :duplicate} ->
        conn
        |> put_status(:conflict)
        |> json(%{error: gettext("You've already reported this message")})

      {:error, %Ecto.Changeset{} = changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  defp with_staff(conn, server_id, fun) do
    case Servers.get_server(server_id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: gettext("Server not found")})

      %Server{} = server ->
        if Servers.moderator?(server.id, conn.assigns.current_user.id) do
          fun.(server)
        else
          conn |> put_status(:forbidden) |> json(%{error: gettext("Forbidden")})
        end
    end
  end

  defp report_json(report) do
    %{
      id: report.id,
      reason: report.reason,
      details: report.details,
      content: report.content,
      file_url: report.file_url,
      message_id: report.message_id,
      status: report.status,
      created_at: report.inserted_at,
      reporter: user_json(report.reporter_id, report.reporter),
      reported_user: user_json(report.reported_user_id, report.reported_user)
    }
  end

  defp user_json(id, user), do: %{id: id, username: Accounts.display_username(user)}

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
