defmodule BackendWeb.UploadDispositionPlug do
  @moduledoc """
  Marks locally stored non-image uploads (PDF, archives, documents — see
  `Backend.Uploads`) as `Content-Disposition: attachment`, so a browser
  opening one downloads it instead of rendering it on this origin. Images
  stay inline for chat previews.

  Runs before `Plug.Static` in endpoint.ex, which keeps headers already on
  the conn. Files in S3/R2 carry the same header as object metadata,
  including the original file name (see `Backend.Uploads.store/1`); the
  local copy can't, since its name is only on the message.
  """

  @behaviour Plug

  import Plug.Conn

  @impl true
  def init(opts), do: opts

  @impl true
  def call(%Plug.Conn{request_path: "/uploads/" <> _} = conn, _opts) do
    case Backend.Uploads.content_disposition(conn.request_path, nil) do
      nil -> conn
      disposition -> put_resp_header(conn, "content-disposition", disposition)
    end
  end

  def call(conn, _opts), do: conn
end
