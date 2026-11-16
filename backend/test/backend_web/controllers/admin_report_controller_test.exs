defmodule BackendWeb.AdminReportControllerTest do
  @moduledoc """
  The platform admins' review of DM reports (a DM has no server staff, so
  its reports come to the platform). Admins are the accounts whose verified
  email is in `config :backend, :admin_emails` (`ADMIN_EMAILS`); nobody
  else can see the list or act on it.
  """
  use BackendWeb.ConnCase, async: false

  alias Backend.{Chat, DirectMessages, Reports, Uploads}
  alias BackendWeb.PrivateFileURL

  setup do
    admin =
      verified_user_fixture(%{
        "email" => "admin#{System.unique_integer([:positive])}@zircle.test"
      })

    reporter = user_fixture()
    author = user_fixture()
    room = dm_room_fixture(reporter, author)

    {:ok, dm} =
      DirectMessages.create_message(%{
        content: "özelden taciz",
        user_id: author.id,
        dm_room_id: room.id
      })

    {:ok, report} =
      Reports.report_dm_message(reporter.id, dm.id, %{
        "reason" => "harassment",
        "details" => "sürekli yazıyor"
      })

    prev = Application.get_env(:backend, :admin_emails)
    # Matched without regard to case.
    Application.put_env(:backend, :admin_emails, [String.upcase(admin.email)])
    on_exit(fn -> Application.put_env(:backend, :admin_emails, prev) end)

    %{admin: admin, reporter: reporter, author: author, room: room, dm: dm, report: report}
  end

  defp as(user) do
    n = System.unique_integer([:positive])

    %{build_conn() | remote_ip: {198, 58, rem(div(n, 250), 250), rem(n, 250) + 1}}
    |> put_req_header("authorization", "Bearer #{token_for(user)}")
  end

  defp list(user), do: get(as(user), ~p"/api/admin/dm-reports")

  defp review(user, id, status),
    do: patch(as(user), ~p"/api/admin/dm-reports/#{id}", %{"status" => status})

  test "says who is an admin", ctx do
    assert %{"is_admin" => true} = json_response(get(as(ctx.admin), ~p"/api/admin"), 200)
    assert %{"is_admin" => false} = json_response(get(as(ctx.reporter), ~p"/api/admin"), 200)
  end

  test "an admin email that isn't verified yet doesn't count", ctx do
    unverified = user_fixture(%{"email" => "pending@zircle.test"})
    Application.put_env(:backend, :admin_emails, [ctx.admin.email, unverified.email])

    assert %{"is_admin" => false} = json_response(get(as(unverified), ~p"/api/admin"), 200)
    assert json_response(list(unverified), 403)
  end

  test "an admin sees the open DM reports with a copy of the message", ctx do
    assert [report] = json_response(list(ctx.admin), 200)

    assert report["id"] == ctx.report.id
    assert report["reason"] == "harassment"
    assert report["details"] == "sürekli yazıyor"
    assert report["content"] == "özelden taciz"
    assert report["dm_message_id"] == ctx.dm.id
    assert report["reporter"] == %{"id" => ctx.reporter.id, "username" => ctx.reporter.username}
    assert report["reported_user"] == %{"id" => ctx.author.id, "username" => ctx.author.username}
    assert report["file_url"] == nil
  end

  test "the copy keeps its content after the message is deleted", ctx do
    {:ok, _} =
      DirectMessages.delete_message(ctx.dm.id, %{user_id: ctx.author.id, dm_room_id: ctx.room.id})

    assert [%{"content" => "özelden taciz"}] = json_response(list(ctx.admin), 200)
  end

  test "a private attachment comes with a link that works", ctx do
    path = Path.join(System.tmp_dir!(), "rapor-#{System.unique_integer([:positive])}.pdf")
    File.write!(path, "%PDF-1.7\n%%EOF")

    {:ok, stored} =
      Uploads.store(
        %Plug.Upload{path: path, filename: "kanıt.pdf", content_type: "application/pdf"},
        private: true
      )

    {:ok, dm} =
      DirectMessages.create_message(%{
        content: "",
        file_url: stored.file_url,
        file_name: stored.file_name,
        user_id: ctx.author.id,
        dm_room_id: ctx.room.id
      })

    {:ok, _} = Reports.report_dm_message(ctx.reporter.id, dm.id, %{"reason" => "inappropriate"})

    report =
      ctx.admin |> list() |> json_response(200) |> Enum.find(&(&1["dm_message_id"] == dm.id))

    assert "/api/files/" <> token = report["file_url"]
    assert {:ok, ref, _name} = PrivateFileURL.verify(token)
    assert ref == stored.file_url
    assert report["file_type"] == "application/pdf"

    assert get(build_conn(), report["file_url"]).status == 200
  end

  test "server reports aren't in the list", ctx do
    owner = user_fixture()
    server = server_fixture(owner)
    add_member_fixture(server, ctx.reporter)

    {:ok, message} =
      Chat.create_message(%{
        content: "sunucuda",
        user_id: owner.id,
        channel_id: default_channel(server).id
      })

    {:ok, server_report} =
      Reports.report_message(ctx.reporter.id, message.id, %{"reason" => "spam"})

    ids = ctx.admin |> list() |> json_response(200) |> Enum.map(& &1["id"])
    assert ctx.report.id in ids
    refute server_report.id in ids

    assert json_response(review(ctx.admin, server_report.id, "resolved"), 404)
  end

  test "an admin resolves or dismisses a report, which leaves the list", ctx do
    assert %{"status" => "resolved"} =
             json_response(review(ctx.admin, ctx.report.id, "resolved"), 200)

    assert [] = json_response(list(ctx.admin), 200)

    reviewed = Backend.Repo.get!(Backend.Reports.Report, ctx.report.id)
    assert reviewed.resolved_by_id == ctx.admin.id
    assert reviewed.resolved_at
  end

  test "a review needs a known status and report", ctx do
    assert json_response(review(ctx.admin, ctx.report.id, "open"), 422)
    assert json_response(review(ctx.admin, Ecto.UUID.generate(), "dismissed"), 404)
    assert json_response(review(ctx.admin, "not-a-uuid", "dismissed"), 404)
  end

  test "nobody else can see or review DM reports", ctx do
    for user <- [ctx.reporter, ctx.author] do
      assert json_response(list(user), 403)
      assert json_response(review(user, ctx.report.id, "dismissed"), 403)
    end

    assert Backend.Repo.get!(Backend.Reports.Report, ctx.report.id).status == "open"
  end

  test "without ADMIN_EMAILS there are no admins", ctx do
    Application.put_env(:backend, :admin_emails, [])

    assert %{"is_admin" => false} = json_response(get(as(ctx.admin), ~p"/api/admin"), 200)
    assert json_response(list(ctx.admin), 403)
  end
end
