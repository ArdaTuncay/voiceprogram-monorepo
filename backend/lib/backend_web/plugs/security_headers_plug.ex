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

  Every `/dev/*` path (LiveDashboard, the Swoosh mailbox preview — see
  router.ex) is exempted from all of the above, same `request_path`-prefix
  approach as `RequireCloudflarePlug`'s `@exempt_paths`. Those routes only
  exist when `Application.compile_env(:backend, :dev_routes)` is true (only
  ever set in config/dev.exs), so in `:prod` this exemption can never match
  anything real — it just stops `default-src 'none'` from also blocking
  LiveDashboard's and the mailbox preview's own inline styles/scripts and
  the preview's email-content iframe locally. Deliberately not also gated
  on `:environment`: a request to `/dev/anything` in prod, where the route
  doesn't exist, just skips headers on what's already a routeless 404 with
  no body to protect — this app never renders HTML in the first place (see
  above), so there's nothing there for the missing CSP/frame-options to
  have been guarding.
  """

  @behaviour Plug

  import Plug.Conn

  @content_security_policy "default-src 'none'; img-src 'self'; frame-ancestors 'none'"
  @dev_path_prefix "/dev/"

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, opts) do
    if String.starts_with?(conn.request_path, @dev_path_prefix) do
      conn
    else
      put_headers(conn, opts)
    end
  end

  defp put_headers(conn, _opts) do
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
