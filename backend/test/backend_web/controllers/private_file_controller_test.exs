defmodule BackendWeb.PrivateFileControllerTest do
  @moduledoc """
  DM attachments are stored privately and handed out only as expiring,
  encrypted links (`/api/files/<token>`), instead of a public URL that
  works forever for anyone it's passed on to.
  """
  # One test overrides the global :reports_email setting.
  use BackendWeb.ConnCase, async: false

  import Swoosh.TestAssertions

  alias Backend.{Chat, DirectMessages, Reports}
  alias BackendWeb.PrivateFileURL

  @pdf "%PDF-1.7\n" <> String.duplicate("gizli", 20)

  setup do
    alice = user_fixture()
    bob = user_fixture()
    %{alice: alice, bob: bob, room: dm_room_fixture(alice, bob)}
  end

  defp as(user) do
    n = System.unique_integer([:positive])

    %{build_conn() | remote_ip: {198, 62, rem(div(n, 250), 250), rem(n, 250) + 1}}
    |> put_req_header("authorization", "Bearer #{token_for(user)}")
  end

  defp upload_private(user, filename, content_type, body) do
    path = Path.join(System.tmp_dir!(), "pf-#{System.unique_integer([:positive])}")
    File.write!(path, body)
    on_exit(fn -> File.rm(path) end)
    upload = %Plug.Upload{path: path, filename: filename, content_type: content_type}

    conn = post(as(user), ~p"/api/upload", %{"file" => upload, "private" => "true"})
    json_response(conn, 200)
  end

  defp dm_with(ctx, stored) do
    {:ok, message} =
      DirectMessages.create_message(%{
        content: "",
        file_url: stored["file_url"],
        file_type: stored["file_type"],
        file_name: stored["file_name"],
        file_size: stored["file_size"],
        user_id: ctx.alice.id,
        dm_room_id: ctx.room.id
      })

    message
  end

  defp served_url(ctx) do
    [message] =
      json_response(get(as(ctx.bob), ~p"/api/dms/#{ctx.room.id}/messages"), 200)["messages"]

    message["file_url"]
  end

  test "a private upload is a reference, not a public file", ctx do
    stored = upload_private(ctx.alice, "rapor.pdf", "application/pdf", @pdf)

    assert "private:" <> name = stored["file_url"]
    refute File.exists?(Path.join([:code.priv_dir(:backend), "static", "uploads", name]))
  end

  test "a DM hands out a link that serves the file without signing in", ctx do
    stored = upload_private(ctx.alice, "Gizli Belge.pdf", "application/pdf", @pdf)
    dm_with(ctx, stored)

    url = served_url(ctx)
    assert "/api/files/" <> _ = url

    conn = get(build_conn(), url)
    assert conn.status == 200
    assert conn.resp_body == @pdf
    assert [content_type] = get_resp_header(conn, "content-type")
    assert content_type =~ "application/pdf"
    assert [disposition] = get_resp_header(conn, "content-disposition")
    assert disposition =~ "attachment"
    assert disposition =~ "Gizli%20Belge.pdf"
    assert get_resp_header(conn, "cache-control") == ["private, max-age=3600"]
    assert get_resp_header(conn, "x-content-type-options") == ["nosniff"]
  end

  test "images are shown inline", ctx do
    png = File.read!(Path.expand("../../support/fixtures/images/location.png", __DIR__))
    stored = upload_private(ctx.alice, "foto.png", "image/png", png)
    dm_with(ctx, stored)

    conn = get(build_conn(), served_url(ctx))
    assert conn.status == 200
    assert get_resp_header(conn, "content-disposition") == []
  end

  test "the link doesn't reveal which stored file it points to", ctx do
    stored = upload_private(ctx.alice, "rapor.pdf", "application/pdf", @pdf)
    dm_with(ctx, stored)
    "private:" <> name = stored["file_url"]

    "/api/files/" <> token = served_url(ctx)
    refute token =~ Path.rootname(name)

    # Every part of the token, decoded, is ciphertext — never the reference.
    for part <- String.split(token, "."),
        {:ok, raw} <- [Base.url_decode64(part, padding: false)] do
      refute raw =~ Path.rootname(name)
    end
  end

  test "an expired, tampered or made-up link is refused", ctx do
    stored = upload_private(ctx.alice, "rapor.pdf", "application/pdf", @pdf)

    expired = PrivateFileURL.path(stored["file_url"], "rapor.pdf", -1)
    assert get(build_conn(), expired).status == 404

    valid = PrivateFileURL.path(stored["file_url"], "rapor.pdf", 60)
    assert get(build_conn(), valid).status == 200

    tampered = String.slice(valid, 0..-6//1) <> "AAAAA"
    assert get(build_conn(), tampered).status == 404
    assert get(build_conn(), "/api/files/nope").status == 404
  end

  test "DM attachments must be private, and channel attachments can't be", ctx do
    stored = upload_private(ctx.alice, "rapor.pdf", "application/pdf", @pdf)

    assert {:error, changeset} =
             DirectMessages.create_message(%{
               content: "",
               file_url: "/uploads/AbCdEfGhIjKlMnOpQrStUv.pdf",
               file_type: "application/pdf",
               user_id: ctx.alice.id,
               dm_room_id: ctx.room.id
             })

    assert %{file_url: [_ | _]} = Backend.DataCase.errors_on(changeset)

    server = server_fixture(ctx.alice)

    assert {:error, changeset} =
             Chat.create_message(%{
               content: "",
               file_url: stored["file_url"],
               file_type: "application/pdf",
               user_id: ctx.alice.id,
               channel_id: default_channel(server).id
             })

    assert %{file_url: [_ | _]} = Backend.DataCase.errors_on(changeset)
  end

  test "a DM report emails the team a link to the file that still works", ctx do
    previous = Application.get_env(:backend, :reports_email)
    Application.put_env(:backend, :reports_email, "reports@example.com")
    on_exit(fn -> Application.put_env(:backend, :reports_email, previous) end)

    stored = upload_private(ctx.alice, "kanit.pdf", "application/pdf", @pdf)
    message = dm_with(ctx, stored)

    {:ok, _} = Reports.report_dm_message(ctx.bob.id, message.id, %{"reason" => "harassment"})

    assert_email_sent(fn email ->
      [_, path] = Regex.run(~r{https?://[^/\s]+(/api/files/\S+)}, email.text_body)
      assert get(build_conn(), path).resp_body == @pdf
    end)
  end
end
