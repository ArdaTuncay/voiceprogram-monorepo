defmodule Backend.Uploads.S3Test do
  @moduledoc """
  With S3/R2 storage, private (DM) files go under `private/` in the bucket
  and are read back through the backend with a signed request — their key
  never reaches a client, so the bucket's public URL for it is never known.
  """
  # :uploads config is global application env.
  use Backend.DataCase, async: false

  alias Backend.Uploads
  alias Backend.Uploads.S3

  @config [
    adapter: :s3,
    bucket: "zircle-uploads",
    region: "auto",
    endpoint: "https://acc.r2.cloudflarestorage.com",
    access_key_id: "AKID",
    secret_access_key: "secret",
    public_url_base: "https://pub-123.r2.dev/"
  ]

  setup do
    previous = Application.get_env(:backend, :uploads)
    Application.put_env(:backend, :uploads, @config)
    on_exit(fn -> Application.put_env(:backend, :uploads, previous) end)
    :ok
  end

  defp pdf_upload do
    path = Path.join(System.tmp_dir!(), "s3t-#{System.unique_integer([:positive])}")
    File.write!(path, "%PDF-1.7\nözel")
    on_exit(fn -> File.rm(path) end)
    %Plug.Upload{path: path, filename: "özel.pdf", content_type: "application/pdf"}
  end

  test "a public upload goes to the bucket root and gets its public URL" do
    test_pid = self()

    Req.Test.stub(Backend.Uploads.S3, fn conn ->
      send(test_pid, {:s3, conn.method, conn.request_path})
      Plug.Conn.send_resp(conn, 200, "")
    end)

    {:ok, %{file_url: url}} = Uploads.store(pdf_upload())

    assert "https://pub-123.r2.dev/" <> name = url
    assert_received {:s3, "PUT", "/zircle-uploads/" <> ^name}
  end

  test "a private upload goes under private/ and is read back with a signed GET" do
    test_pid = self()

    Req.Test.stub(Backend.Uploads.S3, fn conn ->
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      [auth] = Plug.Conn.get_req_header(conn, "authorization")
      send(test_pid, {:s3, conn.method, conn.request_path, auth, body})

      case conn.method do
        "PUT" -> Plug.Conn.send_resp(conn, 200, "")
        "GET" -> Plug.Conn.send_resp(conn, 200, "%PDF-1.7\nözel")
      end
    end)

    {:ok, %{file_url: "private:" <> name = ref}} = Uploads.store(pdf_upload(), private: true)

    assert_received {:s3, "PUT", path, "AWS4-HMAC-SHA256 Credential=AKID/" <> _, "%PDF-1.7\nözel"}
    assert path == "/zircle-uploads/private/" <> name

    assert Uploads.read_private(ref) == {:ok, {:binary, "%PDF-1.7\nözel"}}
    assert_received {:s3, "GET", ^path, "AWS4-HMAC-SHA256 " <> _, ""}
  end

  test "a missing private object reads as not found" do
    Req.Test.stub(Backend.Uploads.S3, &Plug.Conn.send_resp(&1, 404, "<Error/>"))
    assert Uploads.read_private("private:AbCdEfGhIjKlMnOpQrStUv.pdf") == {:error, :not_found}
  end

  test "only private references can be read" do
    assert Uploads.read_private("/uploads/AbCdEfGhIjKlMnOpQrStUv.pdf") == {:error, :not_found}
    assert Uploads.read_private("private:../../etc/passwd") == {:error, :not_found}
  end

  describe "authorization/1 matches AWS's published SigV4 examples" do
    # From AWS's "Signature Calculations for the Authorization Header:
    # Transferring Payload in a Single Chunk" — the same credentials, date
    # and requests, and the signatures AWS lists for them. R2 checks
    # signatures exactly the same way.
    @example %{
      region: "us-east-1",
      access_key_id: "AKIAIOSFODNN7EXAMPLE",
      secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      amz_date: "20130524T000000Z",
      date_stamp: "20130524"
    }

    test "GET Object" do
      auth =
        S3.authorization(
          Map.merge(@example, %{
            method: "GET",
            uri_path: "/test.txt",
            payload_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            headers: %{
              "host" => "examplebucket.s3.amazonaws.com",
              "range" => "bytes=0-9",
              "x-amz-content-sha256" =>
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
              "x-amz-date" => "20130524T000000Z"
            }
          })
        )

      assert auth ==
               "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " <>
                 "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " <>
                 "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    end

    test "PUT Object" do
      payload_hash = "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072"

      auth =
        S3.authorization(
          Map.merge(@example, %{
            method: "PUT",
            uri_path: "/test%24file.text",
            payload_hash: payload_hash,
            headers: %{
              "host" => "examplebucket.s3.amazonaws.com",
              "date" => "Fri, 24 May 2013 00:00:00 GMT",
              "x-amz-content-sha256" => payload_hash,
              "x-amz-date" => "20130524T000000Z",
              "x-amz-storage-class" => "REDUCED_REDUNDANCY"
            }
          })
        )

      assert auth =~
               "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"
    end
  end
end
