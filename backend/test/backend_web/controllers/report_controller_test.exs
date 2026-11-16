defmodule BackendWeb.ReportControllerTest do
  @moduledoc """
  Reporting messages. A report on a server channel message goes to that
  server's owner and moderators, who review it in the server settings. A
  report on a DM goes to the platform (an email to the configured reports
  address), since a DM has no server staff. Either way the report keeps a
  copy of the message, so deleting it afterwards doesn't erase the
  evidence.
  """
  use BackendWeb.ConnCase, async: false

  import Swoosh.TestAssertions

  alias Backend.{Chat, DirectMessages, Servers}

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    mod = user_fixture()
    reporter = user_fixture()
    author = user_fixture()
    for u <- [mod, reporter, author], do: add_member_fixture(server, u)
    {:ok, _} = Servers.set_member_role(server.id, mod.id, "moderator")

    channel = default_channel(server)

    {:ok, message} =
      Chat.create_message(%{content: "kötü söz", user_id: author.id, channel_id: channel.id})

    %{
      owner: owner,
      server: server,
      mod: mod,
      reporter: reporter,
      author: author,
      channel: channel,
      message: message
    }
  end

  defp as(user) do
    n = System.unique_integer([:positive])

    %{build_conn() | remote_ip: {198, 57, rem(div(n, 250), 250), rem(n, 250) + 1}}
    |> put_req_header("authorization", "Bearer #{token_for(user)}")
  end

  defp report(user, body), do: post(as(user), ~p"/api/reports", body)

  defp list(user, server), do: get(as(user), ~p"/api/servers/#{server.id}/reports")

  describe "reporting a server message" do
    test "a member reports it and staff see it with a copy of the message", ctx do
      conn =
        report(ctx.reporter, %{
          "message_id" => ctx.message.id,
          "reason" => "harassment",
          "details" => "  bana hakaret etti  "
        })

      assert %{"id" => _} = json_response(conn, 201)

      for staff <- [ctx.owner, ctx.mod] do
        assert [r] = json_response(list(staff, ctx.server), 200)
        assert r["reason"] == "harassment"
        assert r["details"] == "bana hakaret etti"
        assert r["content"] == "kötü söz"
        assert r["status"] == "open"
        assert r["reported_user"]["id"] == ctx.author.id
        assert r["reporter"]["id"] == ctx.reporter.id
        assert r["message_id"] == ctx.message.id
      end
    end

    test "the copy survives the message being deleted", ctx do
      report(ctx.reporter, %{"message_id" => ctx.message.id, "reason" => "spam"})

      {:ok, _} =
        Chat.delete_message(ctx.message.id, %{user_id: ctx.author.id, channel_id: ctx.channel.id})

      assert [%{"content" => "kötü söz"}] = json_response(list(ctx.owner, ctx.server), 200)
    end

    test "staff are told live that a report came in", ctx do
      BackendWeb.Endpoint.subscribe("user:#{ctx.mod.id}")
      BackendWeb.Endpoint.subscribe("user:#{ctx.author.id}")
      server_id = ctx.server.id

      report(ctx.reporter, %{"message_id" => ctx.message.id, "reason" => "spam"})

      assert_receive %Phoenix.Socket.Broadcast{
        topic: "user:" <> _,
        event: "report_created",
        payload: %{server_id: ^server_id}
      }

      # Only the owner and moderators — never the reported author.
      author_topic = "user:#{ctx.author.id}"
      refute_receive %Phoenix.Socket.Broadcast{topic: ^author_topic, event: "report_created"}
    end

    test "regular members can't see the reports", ctx do
      report(ctx.reporter, %{"message_id" => ctx.message.id, "reason" => "spam"})
      assert json_response(list(ctx.reporter, ctx.server), 403)
      assert json_response(list(ctx.author, ctx.server), 403)
    end

    test "reporting the same message twice is refused", ctx do
      body = %{"message_id" => ctx.message.id, "reason" => "spam"}
      assert json_response(report(ctx.reporter, body), 201)
      assert json_response(report(ctx.reporter, body), 409)
    end

    test "you can't report your own message", ctx do
      assert json_response(
               report(ctx.author, %{"message_id" => ctx.message.id, "reason" => "spam"}),
               422
             )
    end

    test "a non-member can't report (or learn about) the message", ctx do
      stranger = user_fixture()

      assert json_response(
               report(stranger, %{"message_id" => ctx.message.id, "reason" => "spam"}),
               404
             )
    end

    test "an unknown reason or overlong details are rejected", ctx do
      assert json_response(
               report(ctx.reporter, %{"message_id" => ctx.message.id, "reason" => "boring"}),
               422
             )

      assert json_response(
               report(ctx.reporter, %{
                 "message_id" => ctx.message.id,
                 "reason" => "other",
                 "details" => String.duplicate("a", 501)
               }),
               422
             )
    end

    test "a request naming no message is a bad request", ctx do
      assert json_response(report(ctx.reporter, %{"reason" => "spam"}), 400)
    end
  end

  describe "reviewing reports" do
    setup ctx do
      conn = report(ctx.reporter, %{"message_id" => ctx.message.id, "reason" => "spam"})
      %{report_id: json_response(conn, 201)["id"]}
    end

    test "a moderator resolves a report and it leaves the open list", ctx do
      conn =
        patch(as(ctx.mod), ~p"/api/servers/#{ctx.server.id}/reports/#{ctx.report_id}", %{
          "status" => "resolved"
        })

      assert %{"status" => "resolved"} = json_response(conn, 200)
      assert [] = json_response(list(ctx.owner, ctx.server), 200)
    end

    test "the owner dismisses a report", ctx do
      conn =
        patch(as(ctx.owner), ~p"/api/servers/#{ctx.server.id}/reports/#{ctx.report_id}", %{
          "status" => "dismissed"
        })

      assert %{"status" => "dismissed"} = json_response(conn, 200)
    end

    test "a regular member can't review, and a bogus status is rejected", ctx do
      path = ~p"/api/servers/#{ctx.server.id}/reports/#{ctx.report_id}"
      assert json_response(patch(as(ctx.reporter), path, %{"status" => "resolved"}), 403)
      assert json_response(patch(as(ctx.owner), path, %{"status" => "open"}), 422)
    end

    test "a report can't be reached through another server", ctx do
      other = server_fixture(ctx.owner)

      conn =
        patch(as(ctx.owner), ~p"/api/servers/#{other.id}/reports/#{ctx.report_id}", %{
          "status" => "resolved"
        })

      assert json_response(conn, 404)
    end
  end

  describe "reporting a DM" do
    setup ctx do
      room = dm_room_fixture(ctx.reporter, ctx.author)

      {:ok, dm} =
        DirectMessages.create_message(%{
          content: "özelden taciz",
          user_id: ctx.author.id,
          dm_room_id: room.id
        })

      prev = Application.get_env(:backend, :reports_email)
      Application.put_env(:backend, :reports_email, "reports@zircle.test")
      on_exit(fn -> Application.put_env(:backend, :reports_email, prev) end)

      %{room: room, dm: dm}
    end

    test "the other participant reports it and the platform is emailed", ctx do
      conn =
        report(ctx.reporter, %{
          "dm_message_id" => ctx.dm.id,
          "reason" => "harassment",
          "details" => "sürekli yazıyor"
        })

      assert json_response(conn, 201)

      assert_email_sent(fn email ->
        assert email.to == [{"", "reports@zircle.test"}]
        assert email.text_body =~ "özelden taciz"
        assert email.text_body =~ "sürekli yazıyor"
      end)

      # DM reports never show up in any server's list.
      assert [] = json_response(list(ctx.owner, ctx.server), 200)
    end

    test "someone outside the conversation can't report it", ctx do
      assert json_response(
               report(ctx.owner, %{"dm_message_id" => ctx.dm.id, "reason" => "spam"}),
               404
             )
    end
  end
end
