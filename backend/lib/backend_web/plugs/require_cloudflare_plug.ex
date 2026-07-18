defmodule BackendWeb.RequireCloudflarePlug do
  @moduledoc """
  Rejects any request that didn't actually pass through Cloudflare.

  RemoteIp's Cloudflare-IP allowlist (see endpoint.ex) only helps *once* a
  request is known to have come through Cloudflare — it can't stop someone
  from skipping Cloudflare altogether. Render/Railway both hand out a
  public `*.onrender.com` / `*.up.railway.app` fallback hostname that can't
  be disabled, so anyone who knows (or finds) it can hit this app directly:
  no real Cloudflare hop means no WAF, no edge rate limiting, and a forged
  `cf-connecting-ip` header that RemoteIp would otherwise trust at face
  value — a single-value header has nothing else in it to "walk past", so
  RemoteIp's own :proxies allowlist doesn't catch this on its own (see
  RemoteIp's `client_from/2`, which only filters *within* a header's IP
  chain, never checks who actually connected).

  The fix: a Cloudflare Transform Rule adds `X-Origin-Secret: <random
  value>` to every request Cloudflare forwards to the origin — the actual
  client can't see or set this, since Cloudflare adds it after receiving
  the request, not before. This plug just checks that header matches what
  only Cloudflare and this app know. It's the practical equivalent of
  Cloudflare's Authenticated Origin Pulls (mTLS) for a PaaS like Render/
  Railway, which don't expose origin-side TLS client-cert verification.

  No-ops (lets every request through) when :cloudflare_origin_secret isn't
  configured — true in dev/test, where nothing sits in front of the app
  for there to be a secret to check in the first place. Production must
  set the CLOUDFLARE_ORIGIN_SECRET env var (see config/runtime.exs) or
  this plug provides no protection at all.
  """

  import Plug.Conn

  # Render/Railway's own container health check (and Dockerfile's
  # HEALTHCHECK, from inside the container — see Backend.Release.health_check/0)
  # hits this path directly, bypassing Cloudflare entirely by design — there's
  # no Cloudflare hop for a same-host/orchestrator request to have passed
  # through in the first place. Without this exemption, setting
  # CLOUDFLARE_ORIGIN_SECRET in prod would make every health check fail with
  # 403, reading as "unhealthy" and getting the instance killed/cycled — the
  # opposite of what this plug is for.
  @exempt_paths ["/api/healthz"]

  def init(opts), do: opts

  def call(conn, _opts) do
    if conn.request_path in @exempt_paths do
      conn
    else
      check_origin(conn)
    end
  end

  defp check_origin(conn) do
    case Application.get_env(:backend, :cloudflare_origin_secret) do
      nil ->
        conn

      secret ->
        case get_req_header(conn, "x-origin-secret") do
          [^secret] -> conn
          _ -> conn |> send_resp(:forbidden, "") |> halt()
        end
    end
  end
end
