defmodule BackendWeb.AdminReportController do
  @moduledoc """
  The platform admins' review of DM reports — see `Backend.Reports` and
  `Backend.Accounts.platform_admin?/1`.

    * `GET /api/admin`: `%{is_admin: boolean}` for the signed-in user, so
      the app knows whether to offer the review screen.
    * `GET /api/admin/dm-reports`: the open DM reports, newest first.
    * `PATCH /api/admin/dm-reports/:id` with `status` (`"resolved"` or
      `"dismissed"`).

  Anyone but an admin gets 403 from the last two.
  """
  use BackendWeb, :controller

  alias Backend.{Accounts, Reports, Uploads}
  alias BackendWeb.PrivateFileURL

  # A report's private attachment (a DM file) is linked for this long —
  # plenty to look at it, re-issued every time the list loads.
  @file_link_ttl 3600

  plug :require_admin when action in [:index, :update]

  def show(conn, _params) do
    json(conn, %{is_admin: Accounts.platform_admin?(conn.assigns.current_user)})
  end

  def index(conn, _params) do
    json(conn, Enum.map(Reports.list_dm_reports(), &report_json/1))
  end

  def update(conn, %{"id" => id} = params) do
    case Reports.review_dm_report(id, conn.assigns.current_user.id, params["status"]) do
      {:ok, report} ->
        json(conn, %{id: report.id, status: report.status})

      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: gettext("Report not found")})

      {:error, _} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: gettext("Invalid status")})
    end
  end

  defp require_admin(conn, _opts) do
    if Accounts.platform_admin?(conn.assigns.current_user) do
      conn
    else
      conn |> put_status(:forbidden) |> json(%{error: gettext("Forbidden")}) |> halt()
    end
  end

  defp report_json(report) do
    %{
      id: report.id,
      reason: report.reason,
      details: report.details,
      content: report.content,
      file_url: file_link(report.file_url),
      file_type: Uploads.content_type_for_url(report.file_url),
      dm_message_id: report.dm_message_id,
      status: report.status,
      created_at: report.inserted_at,
      reporter: user_json(report.reporter_id, report.reporter),
      reported_user: user_json(report.reported_user_id, report.reported_user)
    }
  end

  # DM attachments are private: only ever handed out as expiring links.
  defp file_link(nil), do: nil

  defp file_link(file_url) do
    if Uploads.private_ref?(file_url),
      do: PrivateFileURL.path(file_url, nil, @file_link_ttl),
      else: file_url
  end

  defp user_json(id, user), do: %{id: id, username: Accounts.display_username(user)}
end
