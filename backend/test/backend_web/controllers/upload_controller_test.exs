defmodule BackendWeb.UploadControllerTest do
  @moduledoc """
  `POST /api/upload` for non-image files, and how stored files are served
  back: images inline, everything else as a download, so a browser never
  tries to render an uploaded document on the API's own origin.
  """
  use BackendWeb.ConnCase, async: true

  alias Backend.Chat

  defp as(user) do
    n = System.unique_integer([:positive])

    %{build_conn() | remote_ip: {198, 61, rem(div(n, 250), 250), rem(n, 250) + 1}}
    |> put_req_header("authorization", "Bearer #{token_for(user)}")
  end

  defp file(filename, content_type, body) do
    path = Path.join(System.tmp_dir!(), "upc-#{System.unique_integer([:positive])}")
    File.write!(path, body)
    on_exit(fn -> File.rm(path) end)
    %Plug.Upload{path: path, filename: filename, content_type: content_type}
  end

  defp upload!(user, upload) do
    body = json_response(post(as(user), ~p"/api/upload", %{"file" => upload}), 200)
    on_exit(fn -> File.rm(Path.join([:code.priv_dir(:backend), "static", body["file_url"]])) end)
    body
  end

  test "returns the stored file's type, name and size" do
    user = user_fixture()

    assert %{
             "file_url" => "/uploads/" <> _,
             "file_type" => "application/zip",
             "file_name" => "proje.zip",
             "file_size" => 12
           } =
             upload!(
               user,
               file("proje.zip", "application/x-zip-compressed", <<"PK", 3, 4, 0::64>>)
             )
  end

  test "names the allowed types when refusing one" do
    conn = post(as(user_fixture()), ~p"/api/upload", %{"file" => file("a.exe", "", "MZ")})
    assert %{"error" => error} = json_response(conn, 422)
    assert error =~ "PDF"
    assert error =~ "ZIP"
  end

  test "documents are served as downloads, images inline" do
    user = user_fixture()

    %{"file_url" => pdf_url} =
      upload!(user, file("rapor.pdf", "application/pdf", "%PDF-1.7\n%%EOF"))

    pdf = get(build_conn(), pdf_url)
    assert pdf.status == 200
    assert get_resp_header(pdf, "content-disposition") == ["attachment"]
    assert get_resp_header(pdf, "x-content-type-options") == ["nosniff"]

    %{"file_url" => png_url} =
      upload!(
        user,
        file(
          "a.png",
          "image/png",
          File.read!(Path.expand("../../support/fixtures/images/location.png", __DIR__))
        )
      )

    png = get(build_conn(), png_url)
    assert png.status == 200
    assert get_resp_header(png, "content-disposition") == []
  end

  test "message history carries the attachment's name and size" do
    owner = user_fixture()
    server = server_fixture(owner)
    channel = default_channel(server)

    {:ok, _} =
      Chat.create_message(%{
        content: "",
        file_url: "/uploads/AbCdEfGhIjKlMnOpQrStUv.pdf",
        file_type: "application/pdf",
        file_name: "ödev.pdf",
        file_size: 2048,
        user_id: owner.id,
        channel_id: channel.id
      })

    [message] =
      json_response(
        get(as(owner), ~p"/api/servers/#{server.id}/channels/#{channel.id}/messages"),
        200
      )["messages"]

    assert %{"file_name" => "ödev.pdf", "file_size" => 2048, "file_type" => "application/pdf"} =
             message
  end
end
