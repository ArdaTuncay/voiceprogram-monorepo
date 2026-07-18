defmodule BackendWeb.InviteControllerRateLimitTest do
  # Hammer's :ets backend is process-global shared state, not per-test
  # sandboxed — concurrent tests hitting the same {controller, action}
  # bucket would corrupt each other's counts, so this runs serialized.
  use BackendWeb.ConnCase, async: false

  test "POST /api/servers/:server_id/invites 429s after 10 requests/min for the same server", %{
    conn: conn
  } do
    owner = user_fixture()
    server = server_fixture(owner)
    conn = put_req_header(conn, "authorization", "Bearer #{token_for(owner)}")

    responses =
      for _ <- 1..11 do
        post(conn, ~p"/api/servers/#{server.id}/invites", %{})
      end

    {allowed, [limited]} = Enum.split(responses, 10)

    assert Enum.all?(allowed, &(&1.status == 201))
    assert limited.status == 429

    assert json_response(limited, 429) == %{
             "error" => "Too many requests. Please try again later."
           }
  end
end
