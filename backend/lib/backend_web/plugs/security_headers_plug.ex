defmodule BackendWeb.SecurityHeadersPlug do
  @moduledoc """
  Adds baseline security response headers to every request, including
  static/upload files served by `Plug.Static` — see endpoint.ex, where this
  runs right after `RequireCloudflarePlug` and before `Plug.Static` so
  nothing downstream can respond without these headers attached.

  This app never renders HTML (see `BackendWeb.Router` — only `/api/*`
  JSON routes, WebSocket sockets, and dev-only LiveDashboard), and the
  React frontend is deployed separately (Vercel), not served from this
  endpoint. `Plug.Static` here only ever serves `favicon.ico`, `robots.txt`,
  and user-uploaded chat images under `/uploads` (see `Backend.Uploads`,
  which only accepts `image/png|jpeg|gif|webp`). The CSP below is scoped
  to exactly that: nothing needs to load a script, a stylesheet, or a
  cross-origin resource from this origin.

  HSTS is gated on the runtime `:environment` flag (see config/runtime.exs)
  rather than compile-time `Mix.env()`, and only sent in `:prod` — sending
  it in dev would tell browsers to remember an HTTPS-only policy for a
  plain-HTTP local server.
  """

  @behaviour Plug

  import Plug.Conn

  @content_security_policy "default-src 'none'; img-src 'self'; frame-ancestors 'none'"

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    conn
    |> put_resp_header("x-content-type-options", "nosniff")
    |> put_resp_header("referrer-policy", "strict-origin-when-cross-origin")
    |> put_resp_header("x-frame-options", "DENY")
    |> put_resp_header("content-security-policy", @content_security_policy)
    |> maybe_put_hsts()
  end

  defp maybe_put_hsts(conn) do
    if Application.get_env(:backend, :environment) == :prod do
      put_resp_header(conn, "strict-transport-security", "max-age=31536000; includeSubDomains")
    else
      conn
    end
  end
end
