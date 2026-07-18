defmodule BackendWeb.VoiceControllerRateLimitTest do
  # Hammer's :ets backend is process-global shared state, not per-test
  # sandboxed (see invite_controller_rate_limit_test.exs's own note) —
  # runs serialized.
  use BackendWeb.ConnCase, async: false

  test "GET /api/voice/turn-credentials 429s after 10 requests/min for the same user", %{
    conn: conn
  } do
    user = user_fixture()

    conn =
      conn
      |> put_req_header("authorization", "Bearer #{token_for(user)}")
      # A distinct fake IP from voice_controller_test.exs's own tests —
      # see that file's with_unique_ip/2 comment for why this matters
      # (the plug's per-IP bucket is shared across any test conn using
      # the same fake remote_ip).
      |> Map.put(:remote_ip, {203, 0, 113, 100})

    responses = for _ <- 1..11, do: get(conn, ~p"/api/voice/turn-credentials")

    {allowed, [limited]} = Enum.split(responses, 10)

    assert Enum.all?(allowed, &(&1.status == 200))
    assert limited.status == 429

    assert json_response(limited, 429) == %{
             "error" => "Too many requests. Please try again later."
           }
  end
end
