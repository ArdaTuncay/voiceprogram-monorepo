defmodule BackendWeb.UploadQuotaControllerTest do
  @moduledoc "`POST /api/upload` once the storage limit is reached. Not async: it changes the limit."
  use BackendWeb.ConnCase, async: false

  setup do
    previous = Application.get_env(:backend, :uploads_quota_bytes)
    on_exit(fn -> Application.put_env(:backend, :uploads_quota_bytes, previous) end)
    :ok
  end

  test "answers 507 with a readable message when storage is full" do
    Application.put_env(:backend, :uploads_quota_bytes, 0)
    path = Path.join(System.tmp_dir!(), "uqc-#{System.unique_integer([:positive])}")
    File.write!(path, "%PDF-1.7\nfull")
    on_exit(fn -> File.rm(path) end)
    upload = %Plug.Upload{path: path, filename: "belge.pdf", content_type: "application/pdf"}

    conn =
      build_conn()
      |> put_req_header("authorization", "Bearer #{token_for(user_fixture())}")
      |> post(~p"/api/upload", %{"file" => upload})

    assert %{"error" => message} = json_response(conn, 507)
    assert message =~ ~r/Storage is full|Depolama alanı doldu/
  end
end
