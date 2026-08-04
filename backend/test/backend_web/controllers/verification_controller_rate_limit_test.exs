defmodule BackendWeb.VerificationControllerRateLimitTest do
  # Hammer's :ets backend is process-global shared state, not per-test
  # sandboxed — see friend_controller_rate_limit_test.exs's identical note.
  use BackendWeb.ConnCase, async: false

  # A distinct fake IP from every other test that touches
  # {VerificationController, :resend} (see verification_controller_test.exs's
  # with_unique_ip/2) — this test deliberately exhausts the 5/minute
  # allowance, so it must not share a bucket with anything else.
  defp with_unique_ip(conn), do: %{conn | remote_ip: {203, 0, 113, 199}}

  test "POST /api/resend-verification 429s after 5 requests/min from the same IP", %{conn: conn} do
    conn = with_unique_ip(conn)

    # A different (nonexistent) email on every request: the guard still
    # hits its per-IP bucket regardless (see BackendWeb.RateLimiterPlug),
    # and resend/2 returns the same generic 200 for an unknown email either
    # way, so no user fixtures are needed to exercise this.
    responses =
      for n <- 1..6 do
        post(conn, ~p"/api/resend-verification", %{"email" => "probe#{n}@example.com"})
      end

    {allowed, denied} = Enum.split_with(responses, &(&1.status == 200))

    assert length(allowed) == 5
    assert [limited] = denied

    assert json_response(limited, 429) == %{
             "error" => "Too many requests. Please try again later."
           }
  end
end
