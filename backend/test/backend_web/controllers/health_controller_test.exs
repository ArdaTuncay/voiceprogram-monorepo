defmodule BackendWeb.HealthControllerTest do
  # async: false — the "database unreachable" test below deliberately
  # checks this process's own sandboxed DB connection back in mid-test to
  # simulate a real outage (see its comment), which only this test's
  # process should ever do.
  use BackendWeb.ConnCase, async: false

  alias Ecto.Adapters.SQL.Sandbox

  test "GET /api/healthz returns 200 with an ok status when the database is reachable", %{
    conn: conn
  } do
    conn = get(conn, ~p"/api/healthz")

    assert json_response(conn, 200) == %{"status" => "ok", "database" => "ok"}
  end

  test "GET /api/healthz returns 503 when the database is unreachable", %{
    conn: conn,
    sandbox_owner: sandbox_owner
  } do
    # Stops this test's sandbox owner process early — the safest way
    # available to simulate a real "can't reach Postgres" failure: it only
    # affects this one test's own connection (checked out via
    # BackendWeb.ConnCase's setup, shared: true since this module is
    # async: false), not Backend.Repo's connection pool as a whole, which
    # every other (concurrently running async: true) test also depends on.
    # `Sandbox.checkin/1` alone doesn't do this — in `shared` mode the
    # checked-out connection belongs to this owner process, not whichever
    # process happens to call checkin, so nothing changes unless the owner
    # itself goes away.
    Sandbox.stop_owner(sandbox_owner)

    conn = get(conn, ~p"/api/healthz")

    assert json_response(conn, 503) == %{"status" => "error", "database" => "error"}
  end
end
