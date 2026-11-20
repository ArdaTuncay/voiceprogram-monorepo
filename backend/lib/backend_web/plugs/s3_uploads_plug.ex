defmodule BackendWeb.S3UploadsPlug do
  @moduledoc """
  Serves public uploads kept in S3/R2 at `/uploads/<name>`, through this
  backend, when `S3_PUBLIC_URL_BASE` points here
  (`https://<backend>/uploads`).

  Why: the bucket's own public address (`pub-….r2.dev`) is blocked on
  common Turkish networks (filtered by name during the TLS handshake), so
  images linked there never load. This backend's own host is reachable, so
  it fetches the object with a signed request (see `Backend.Uploads.S3`)
  and sends it on. Once a custom domain is attached to the bucket,
  `S3_PUBLIC_URL_BASE` can point there instead and this plug simply stops
  being hit.

  Runs after `Plug.Static` (a file still on local disk wins) and after
  `BackendWeb.UploadDispositionPlug` and the security headers, so a
  document still downloads under its original name and nothing is sniffed.
  Only bucket-root names of the form `<random>.<ext>` are served — never
  anything under `private/` (DM files), which stay behind
  `BackendWeb.PrivateFileURL`.
  """

  @behaviour Plug

  import Plug.Conn

  alias Backend.Uploads
  alias Backend.Uploads.S3

  # Names `Backend.Uploads` generates: url-safe random part + extension.
  @name ~r/\A[A-Za-z0-9_-]{8,64}\.[a-z0-9]{1,5}\z/

  @impl true
  def init(opts), do: opts

  @impl true
  def call(%Plug.Conn{method: method, path_info: ["uploads", name]} = conn, _opts)
      when method in ["GET", "HEAD"] do
    if s3?() and Regex.match?(@name, name), do: serve(conn, name), else: conn
  end

  def call(conn, _opts), do: conn

  defp serve(conn, name) do
    with type when is_binary(type) <- Uploads.content_type_for_url(name),
         {:ok, body} <- S3.download(name) do
      conn
      |> put_resp_content_type(type, nil)
      # Names are random and never reused, so the bytes behind one never change.
      |> put_resp_header("cache-control", "public, max-age=31536000, immutable")
      |> send_resp(200, if(conn.method == "HEAD", do: "", else: body))
      |> halt()
    else
      _ -> conn |> send_resp(404, "") |> halt()
    end
  end

  defp s3?, do: Keyword.get(Application.get_env(:backend, :uploads, []), :adapter) == :s3
end
