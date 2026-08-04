defmodule BackendWeb.AccountControllerRateLimitTest do
  # Hammer's :ets backend is process-global shared state, not per-test
  # sandboxed — see friend_controller_rate_limit_test.exs's identical note.
  use BackendWeb.ConnCase, async: false

  # BackendWeb.RateLimiterPlug always hits a per-IP bucket in addition to
  # the :current_user one, and Phoenix.ConnTest's build_conn() gives every
  # test conn the same fake remote_ip by default — account_controller_test.exs's
  # functional tests (async: true, so they've already run by the time this
  # file's async: false test starts) hit this same {AccountController,
  # :update_username} action on that shared default IP, which would
  # otherwise eat into this test's 5-per-minute allowance before it even
  # starts. See voice_controller_test.exs's identical fix/comment.
  defp with_unique_ip(conn), do: %{conn | remote_ip: {203, 0, 113, 77}}

  test "PATCH /api/account/username 429s after 5 requests/min from the same caller", %{
    conn: conn
  } do
    user = user_fixture(%{"password" => "correct-password"})

    conn =
      conn
      |> put_req_header("authorization", "Bearer #{token_for(user)}")
      |> with_unique_ip()

    # Deliberately wrong current_password on every request — the rate
    # limiter plug runs before the handler does any work, so this fires
    # even without ever actually renaming the user, and it isolates this
    # test from update_username/2's own success/failure behavior.
    responses =
      for _ <- 1..6 do
        patch(conn, ~p"/api/account/username", %{
          "username" => "irrelevant",
          "current_password" => "wrong-on-purpose"
        })
      end

    {allowed, denied} = Enum.split_with(responses, &(&1.status == 401))

    assert length(allowed) == 5
    assert [limited] = denied

    assert json_response(limited, 429) == %{
             "error" => "Too many requests. Please try again later."
           }
  end

  test "DELETE /api/account 429s after 3 requests/min from the same caller", %{conn: conn} do
    user = user_fixture(%{"password" => "correct-password"})

    conn =
      conn
      |> put_req_header("authorization", "Bearer #{token_for(user)}")
      # A different IP from the username test above — :delete is its own
      # rate-limiter bucket (keyed by {controller, action}) regardless, but
      # a fresh one keeps this test independent of that one's IP history too.
      |> Map.put(:remote_ip, {203, 0, 113, 89})

    # Deliberately wrong current_password on every request, same reasoning
    # as the username test above — the plug runs before delete/2 does any
    # real work, so the account is never actually deleted mid-loop.
    responses =
      for _ <- 1..4 do
        delete(conn, ~p"/api/account", %{"current_password" => "wrong-on-purpose"})
      end

    {allowed, denied} = Enum.split_with(responses, &(&1.status == 401))

    assert length(allowed) == 3
    assert [limited] = denied

    assert json_response(limited, 429) == %{
             "error" => "Too many requests. Please try again later."
           }
  end
end
