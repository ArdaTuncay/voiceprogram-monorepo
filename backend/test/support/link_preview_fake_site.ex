defmodule Backend.LinkPreviewFakeSite do
  @moduledoc """
  A tiny website for `Backend.LinkPreviewTest`, served by a real Bandit
  listener on 127.0.0.1. Each path plays one scenario the link-preview
  fetcher has to handle safely (redirects to internal addresses, endless
  bodies, non-HTML, slow responses).
  """

  import Plug.Conn

  # Big enough that the 1 MB read cap is hit long before the end.
  @huge_total_bytes 5_000_000
  @huge_late_marker_at 2_000_000
  @chunk String.duplicate("<!-- filler -->", 4_096)

  def init(opts), do: opts

  def call(%{request_path: "/ok"} = conn, _opts) do
    html(conn, """
    <html><head>
    <meta property="og:title" content="Zircle &amp; Arkadaşlar">
    <meta property="og:description" content="Açıklama">
    <meta property="og:image" content="/kapak.png">
    <meta property="og:site_name" content="Test Sitesi">
    </head><body></body></html>
    """)
  end

  def call(%{request_path: "/redirect-relative"} = conn, _opts), do: redirect(conn, "/ok")
  def call(%{request_path: "/redirect-loop"} = conn, _opts), do: redirect(conn, "/redirect-loop")

  def call(%{request_path: "/redirect-internal"} = conn, _opts),
    do: redirect(conn, "http://169.254.169.254/latest/meta-data/")

  def call(%{request_path: "/redirect-other-port"} = conn, _opts),
    do: redirect(conn, "http://site.test:6379/")

  def call(%{request_path: "/redirect-no-location"} = conn, _opts),
    do: send_resp(conn, 302, "")

  def call(%{request_path: "/not-html"} = conn, _opts) do
    conn |> put_resp_content_type("image/png") |> send_resp(200, "\x89PNG")
  end

  def call(%{request_path: "/error"} = conn, _opts), do: html(conn, "<title>x</title>", 500)

  def call(%{request_path: "/bad-entities"} = conn, _opts) do
    html(
      conn,
      ~s|<title>a&#xD800;b&#55296;c</title><meta property="og:image" content="javascript:alert(1)">|
    )
  end

  def call(%{request_path: "/slow"} = conn, _opts) do
    Process.sleep(2_000)
    html(conn, "<title>geç</title>")
  end

  def call(%{request_path: "/huge"} = conn, _opts) do
    conn =
      conn
      |> put_resp_content_type("text/html")
      |> send_chunked(200)

    {:ok, conn} = chunk(conn, ~s(<meta property="og:title" content="Başta">))
    stream_filler(conn, 0)
  end

  def call(conn, _opts), do: send_resp(conn, 404, "")

  # Stops as soon as the client goes away — which, for the fetcher under
  # test, is the point: it should hang up long before @huge_total_bytes.
  defp stream_filler(conn, sent) when sent >= @huge_total_bytes, do: conn

  defp stream_filler(conn, sent) do
    data =
      if sent >= @huge_late_marker_at and sent < @huge_late_marker_at + byte_size(@chunk),
        do: ~s(<meta property="og:description" content="Sonda">) <> @chunk,
        else: @chunk

    case chunk(conn, data) do
      {:ok, conn} -> stream_filler(conn, sent + byte_size(data))
      {:error, _closed} -> conn
    end
  end

  defp html(conn, body, status \\ 200) do
    conn |> put_resp_content_type("text/html") |> send_resp(status, body)
  end

  defp redirect(conn, location) do
    conn |> put_resp_header("location", location) |> send_resp(302, "")
  end
end
