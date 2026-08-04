defmodule BackendWeb.BlockControllerRateLimitTest do
  # Hammer's :ets backend is process-global shared state, not per-test
  # sandboxed — see friend_controller_rate_limit_test.exs's identical note.
  use BackendWeb.ConnCase, async: false

  # Same reasoning/fix as account_controller_rate_limit_test.exs's
  # with_unique_ip — block_controller_test.exs's functional tests
  # (async: true, already run by the time this async: false test starts)
  # hit this same {BlockController, :create} action on the shared default
  # fake IP Phoenix.ConnTest gives every conn.
  defp with_unique_ip(conn), do: %{conn | remote_ip: {203, 0, 113, 88}}

  test "POST /api/users/:id/block 429s after 10 requests/min from the same caller", %{
    conn: conn
  } do
    user = user_fixture()

    conn =
      conn
      |> put_req_header("authorization", "Bearer #{token_for(user)}")
      |> with_unique_ip()

    # A different (nonexistent) target on every request — doesn't matter
    # whether the block itself succeeds, only that the rate limiter plug
    # runs (and counts) before the handler does any work.
    responses =
      for _ <- 1..11 do
        post(conn, ~p"/api/users/#{Ecto.UUID.generate()}/block")
      end

    {allowed, denied} = Enum.split_with(responses, &(&1.status == 404))

    assert length(allowed) == 10
    assert [limited] = denied

    assert json_response(limited, 429) == %{
             "error" => "Too many requests. Please try again later."
           }
  end
end
