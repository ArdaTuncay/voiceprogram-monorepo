defmodule BackendWeb.UploadDispositionPlug do
  @moduledoc """
  Marks locally stored non-image uploads (PDF, archives, documents — see
  `Backend.Uploads`) as `Content-Disposition: attachment`, so a browser
  opening one downloads it instead of rendering it on this origin. Images
  stay inline for chat previews.

  The stored file's name is random; its original name lives only on the
  message. So a link may ask for a download name — `/uploads/<name>?name=Ödev.pdf`,
  which the frontend adds from the message — and the file downloads under
  it, always with the stored file's own extension (see
  `Backend.Uploads.download_name/2`), so the name can't make a PDF land as
  an `.exe`.

  Runs before `Plug.Static` in endpoint.ex, which keeps headers already on
  the conn. Files in S3/R2 carry the same header as object metadata,
  including the original file name (see `Backend.Uploads.store/1`).
  """

  @behaviour Plug

  import Plug.Conn

  alias Backend.Uploads

  @impl true
  def init(opts), do: opts

  @impl true
  def call(%Plug.Conn{request_path: "/uploads/" <> _} = conn, _opts) do
    conn = fetch_query_params(conn)
    name = Uploads.download_name(conn.request_path, conn.query_params["name"])

    case Uploads.content_disposition(conn.request_path, name) do
      nil -> conn
      disposition -> put_resp_header(conn, "content-disposition", disposition)
    end
  end

  def call(conn, _opts), do: conn
end
