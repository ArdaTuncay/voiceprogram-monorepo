defmodule BackendWeb.FriendControllerRateLimitTest do
  # Hammer's :ets backend is process-global shared state, not per-test
  # sandboxed — concurrent tests hitting the same {controller, action}
  # bucket would corrupt each other's counts, so this runs serialized.
  use BackendWeb.ConnCase, async: false

  test "POST /api/friends/request 429s after 20 requests/min from the same caller", %{
    conn: conn
  } do
    caller = user_fixture()
    conn = put_req_header(conn, "authorization", "Bearer #{token_for(caller)}")

    # A different target on every request: the guard is keyed on the
    # authenticated caller (see BackendWeb.RateLimiterPlug's :current_user
    # key), not the target being probed, so varying the target must not
    # reset the count — that's exactly the enumeration case this protects
    # against. Created *before* the timed burst below (see its comment).
    targets = for _ <- 1..21, do: user_fixture()

    # `Backend.RateLimiter` uses Hammer's default fixed-window algorithm,
    # whose windows are anchored to absolute wall-clock time
    # (`System.system_time/1`, no clock injection available — see
    # PROJECT_ARCHITECTURE.md §2.3). The original version of this test
    # created each target user *inside* the request loop below, which means
    # every iteration paid for a Pbkdf2 password hash at full/production
    # cost — that dominated the loop's per-iteration cost and added up to
    # ~5s of wall time for 21 sequential requests, long enough relative to
    # the 1-minute window that a minute boundary had a real (~9%) chance of
    # landing mid-burst, resetting Hammer's counter and letting the 21st
    # request through as a false negative — a test-timing race, not the
    # rate limiter misbehaving. With fixture creation hoisted above (out of
    # the timed section), this loop is just lookup+insert per request, no
    # hashing — measured at ~80ms for all 21 requests, cutting the
    # window-boundary collision odds to a negligible ~0.1%.
    responses =
      for target <- targets do
        post(conn, ~p"/api/friends/request", %{"username" => target.username})
      end

    {allowed, denied} = Enum.split_with(responses, &(&1.status == 201))

    assert length(allowed) == 20
    assert [limited] = denied

    assert json_response(limited, 429) == %{
             "error" => "Too many requests. Please try again later."
           }
  end
end
