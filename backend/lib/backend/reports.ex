defmodule Backend.Reports do
  @moduledoc """
  Message reports.

  A report on a server channel message is reviewed by that server's owner
  and moderators (`list_server_reports/1`, `review_report/4`), who are told
  live through a `"report_created"` broadcast on their own user topics. A
  report on a DM goes to the platform instead, as an email to the address
  in `config :backend, :reports_email` (`REPORTS_EMAIL`), since a DM has no
  server staff to review it.

  Each report stores a copy of the message's content, so deleting the
  message afterwards doesn't erase the evidence. A user can report a given
  message once, can't report their own messages, and can only report
  messages they can see.
  """

  import Ecto.Query
  require Logger

  alias Backend.{Chat, DirectMessages, Repo, Servers}
  alias Backend.Chat.{Channel, Message}
  alias Backend.DirectMessages.DmMessage
  alias Backend.Reports.{Report, ReportNotifier}

  @doc """
  Reports server channel message `message_id` on behalf of `reporter_id`.

  Returns `{:ok, report}`, `{:error, :not_found}` (no such message, or the
  reporter can't see it), `{:error, :own_message}`, `{:error, :duplicate}`,
  or `{:error, changeset}`.
  """
  def report_message(reporter_id, message_id, attrs) do
    with %Message{} = message <- fetch(Message, message_id),
         %Channel{server_id: server_id} when is_binary(server_id) <-
           Chat.get_channel(message.channel_id),
         true <- Servers.member?(server_id, reporter_id),
         :ok <- not_own(message, reporter_id),
         {:ok, report} <-
           insert(attrs, message, reporter_id, server_id: server_id, message_id: message.id) do
      notify_server_staff(report)
      {:ok, report}
    else
      {:error, _} = error -> error
      _ -> {:error, :not_found}
    end
  end

  @doc """
  Reports DM message `dm_message_id` on behalf of `reporter_id`, who must be
  in that conversation, and emails the platform's reports address. Same
  return values as `report_message/3`.
  """
  def report_dm_message(reporter_id, dm_message_id, attrs) do
    with %DmMessage{} = message <- fetch(DmMessage, dm_message_id),
         %{} = room <- DirectMessages.get_room(message.dm_room_id),
         true <- DirectMessages.member?(room, reporter_id),
         :ok <- not_own(message, reporter_id),
         {:ok, report} <- insert(attrs, message, reporter_id, dm_message_id: message.id) do
      email_platform(report)
      {:ok, report}
    else
      {:error, _} = error -> error
      _ -> {:error, :not_found}
    end
  end

  @doc "A server's open reports, newest first, with reporter and reported user preloaded."
  def list_server_reports(server_id) do
    Report
    |> where([r], r.server_id == ^server_id and r.status == "open")
    |> order_by([r], desc: r.inserted_at, desc: r.id)
    |> preload([:reporter, :reported_user])
    |> Repo.all()
  end

  @doc """
  Marks a report of `server_id` as `"resolved"` or `"dismissed"`. Scoped to
  the server so staff of one server can't touch another's reports; the
  caller checks that the reviewer is the owner or a moderator.

  Returns `{:ok, report}`, `{:error, :not_found}`, `{:error, :invalid_status}`
  or `{:error, changeset}`.
  """
  def review_report(server_id, report_id, reviewer_id, status) do
    if status in Report.review_statuses(),
      do: do_review(server_id, report_id, reviewer_id, status),
      else: {:error, :invalid_status}
  end

  defp do_review(server_id, report_id, reviewer_id, status) do
    with {:ok, _} <- Ecto.UUID.cast(report_id),
         %Report{} = report <- Repo.get_by(Report, id: report_id, server_id: server_id) do
      report |> Report.review_changeset(status, reviewer_id) |> Repo.update()
    else
      _ -> {:error, :not_found}
    end
  end

  defp fetch(schema, id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         %{deleted_at: nil} = message <- Repo.get(schema, id) do
      message
    else
      _ -> nil
    end
  end

  defp not_own(%{user_id: author_id}, author_id), do: {:error, :own_message}
  defp not_own(_message, _reporter_id), do: :ok

  defp insert(attrs, message, reporter_id, refs) do
    %Report{
      reporter_id: reporter_id,
      reported_user_id: message.user_id,
      content: message.content,
      file_url: message.file_url
    }
    |> struct!(refs)
    |> Report.create_changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, report} -> {:ok, report}
      {:error, changeset} -> {:error, if(duplicate?(changeset), do: :duplicate, else: changeset)}
    end
  end

  defp duplicate?(changeset) do
    Enum.any?(changeset.errors, fn {_field, {_msg, opts}} -> opts[:constraint] == :unique end)
  end

  defp notify_server_staff(%Report{} = report) do
    payload = %{server_id: report.server_id, report_id: report.id}

    report.server_id
    |> Servers.list_moderator_ids()
    |> Enum.each(&BackendWeb.Endpoint.broadcast("user:#{&1}", "report_created", payload))
  end

  defp email_platform(%Report{} = report) do
    case Application.get_env(:backend, :reports_email) do
      address when is_binary(address) and address != "" ->
        report = Repo.preload(report, [:reporter, :reported_user])

        case ReportNotifier.deliver_dm_report(address, report) do
          {:ok, _} ->
            :ok

          {:error, reason} ->
            Logger.error(
              "DM raporu e-postası gönderilemedi: #{inspect(reason)} report_id=#{report.id}"
            )
        end

      _ ->
        Logger.warning(
          "DM raporu kaydedildi ama REPORTS_EMAIL ayarlı değil, kimseye bildirilmedi report_id=#{report.id}"
        )
    end
  end
end
