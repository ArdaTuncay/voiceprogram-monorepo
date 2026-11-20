defmodule BackendWeb.S3UploadsPlugTest do
  @moduledoc """
  With S3/R2 storage, `/uploads/<name>` on the backend fetches the object
  from the bucket and sends it on (the bucket's r2.dev address is blocked
  on common Turkish networks). Not async: the :uploads config is global.
  """
  use BackendWeb.ConnCase, async: false

  @config [
    adapter: :s3,
    bucket: "zircle-uploads",
    region: "auto",
    endpoint: "https://acc.r2.cloudflarestorage.com",
    access_key_id: "AKID",
    secret_access_key: "secret",
    public_url_base: "https://backend.example/uploads"
  ]

  setup do
    previous = Application.get_env(:backend, :uploads)
    Application.put_env(:backend, :uploads, @config)
    on_exit(fn -> Application.put_env(:backend, :uploads, previous) end)

    test_pid = self()

    Req.Test.stub(Backend.Uploads.S3, fn conn ->
      send(test_pid, {:s3, conn.method, conn.request_path})

      case conn.request_path do
        "/zircle-uploads/missingfile00.png" -> Plug.Conn.send_resp(conn, 404, "<Error/>")
        "/zircle-uploads/" <> _ -> Plug.Conn.send_resp(conn, 200, "BYTES")
      end
    end)

    :ok
  end

  test "an image is fetched from the bucket and served inline, cacheable for good" do
    conn = get(build_conn(), "/uploads/AbCdEfGh12345678.png")

    assert response(conn, 200) == "BYTES"
    assert [type] = get_resp_header(conn, "content-type")
    assert type =~ "image/png"
    assert get_resp_header(conn, "cache-control") == ["public, max-age=31536000, immutable"]
    assert get_resp_header(conn, "content-disposition") == []
    assert_received {:s3, "GET", "/zircle-uploads/AbCdEfGh12345678.png"}
  end

  test "a document downloads under the name the link asks for" do
    conn = get(build_conn(), "/uploads/AbCdEfGh12345678.pdf?name=Ödev.pdf")

    assert response(conn, 200) == "BYTES"
    assert [disposition] = get_resp_header(conn, "content-disposition")
    assert disposition =~ "attachment"
  end

  test "a name that isn't in the bucket is a 404" do
    conn = get(build_conn(), "/uploads/missingfile00.png")
    assert response(conn, 404)
  end

  test "private (DM) files are never reachable this way" do
    conn = get(build_conn(), "/uploads/private/AbCdEfGh12345678.pdf")

    assert conn.status == 404
    refute_received {:s3, _, _}
  end

  test "with local storage the plug stays out of the way" do
    Application.put_env(:backend, :uploads, adapter: :local)

    conn = get(build_conn(), "/uploads/AbCdEfGh12345678.png")

    assert conn.status == 404
    refute_received {:s3, _, _}
  end
end
