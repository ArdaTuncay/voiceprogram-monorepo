defmodule BackendWeb.HealthController do
  @moduledoc """
  Unauthenticated liveness/readiness probe for the container orchestrator
  (Render/Railway's own HTTP health check, or a future k8s-style
  readinessProbe) — see router.ex for why this sits in the unauthenticated
  `:api` scope and BackendWeb.RequireCloudflarePlug for why it's exempt
  from the Cloudflare-origin check (the orchestrator hits this directly,
  never through Cloudflare). Also backs Dockerfile's HEALTHCHECK, via
  Backend.Release.health_check/0 (see rel/overlays/bin/healthcheck),
  which makes the same real HTTP request this describes from inside the
  container itself.

  Checks more than "the BEAM process is up": a plain `SELECT 1` round trip
  through Backend.Repo confirms the database connection pool is actually
  reachable, not just that the app booted. A process can be alive with a
  dead DB connection (Postgres restarted, network partition, exhausted
  pool) — that's exactly the case an orchestrator needs to know about to
  stop routing traffic to this instance.
  """

  use BackendWeb, :controller

  alias Backend.Repo

  @doc "GET /api/healthz"
  def show(conn, _params) do
    case Repo.query("SELECT 1") do
      {:ok, _result} ->
        json(conn, %{status: "ok", database: "ok"})

      {:error, _reason} ->
        conn
        |> put_status(:service_unavailable)
        |> json(%{status: "error", database: "error"})
    end
  rescue
    # A truly severed connection (e.g. no pool member checked out at all)
    # can raise instead of returning {:error, _} — DBConnection.* errors in
    # particular. Either way the answer is the same: this instance can't
    # reach its database right now, so still 503 instead of crashing this
    # request with a 500 the orchestrator can't distinguish from "actually
    # broken app code".
    _ ->
      conn
      |> put_status(:service_unavailable)
      |> json(%{status: "error", database: "error"})
  end
end
