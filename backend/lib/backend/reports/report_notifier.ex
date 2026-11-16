defmodule Backend.Reports.ReportNotifier do
  @moduledoc "Emails a DM report to the platform's reports address (see `Backend.Reports`)."

  import Swoosh.Email

  alias Backend.Accounts
  alias Backend.Reports.Report

  @doc "Sends `report` (with :reporter and :reported_user preloaded) to `address`."
  def deliver_dm_report(address, %Report{} = report) do
    reporter = Accounts.display_username(report.reporter) || "?"
    reported = Accounts.display_username(report.reported_user) || "?"
    file_line = if report.file_url, do: "Dosya: #{file_link(report.file_url)}\n", else: ""

    body = """
    Yeni DM raporu

    Rapor no: #{report.id}
    Raporlayan: #{reporter} (#{report.reporter_id})
    Raporlanan: #{reported} (#{report.reported_user_id})
    Sebep: #{report.reason}
    Açıklama: #{report.details || "-"}
    Tarih: #{report.inserted_at}

    Mesaj:
    #{report.content || "(metin yok)"}
    #{file_line}
    """

    new()
    |> from(Application.fetch_env!(:backend, :mailer_from))
    |> to(address)
    |> subject("Zircle - DM raporu (#{report.reason})")
    |> text_body(body)
    |> Backend.Mailer.deliver()
  end

  # DM attachments are private: the team gets an expiring link, long enough
  # to review the report. Older (public) attachments are linked as stored.
  @review_window 7 * 24 * 3600

  defp file_link(file_url) do
    if Backend.Uploads.private_ref?(file_url),
      do: BackendWeb.PrivateFileURL.url(file_url, nil, @review_window),
      else: file_url
  end
end
