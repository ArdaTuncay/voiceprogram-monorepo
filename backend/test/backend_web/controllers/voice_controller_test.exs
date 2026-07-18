defmodule BackendWeb.VoiceControllerTest do
  # Backend.Turn reads Application.get_env(:backend, :turn_config) — a
  # global, process-independent value, not per-test sandboxed. The
  # "config set" test below temporarily overrides it and restores it via
  # on_exit; async: true would risk that leaking into (or racing with)
  # another concurrently-running test that assumes it's unset.
  use BackendWeb.ConnCase, async: false

  # BackendWeb.RateLimiterPlug always hits a per-IP bucket in addition to
  # any :key-derived one (see its own moduledoc) — Phoenix.ConnTest's
  # build_conn() gives every test conn the same fake remote_ip by
  # default, so two tests hitting this same rate-limited action would
  # otherwise share that IP bucket and could intermittently 429 each
  # other depending on run order/timing (this action's dedicated
  # voice_controller_rate_limit_test.exs deliberately exhausts it).
  # Each test here gets its own distinct fake IP so that can't happen.
  defp with_unique_ip(conn, last_octet), do: %{conn | remote_ip: {203, 0, 113, last_octet}}

  test "GET /api/voice/turn-credentials requires authentication", %{conn: conn} do
    conn = conn |> with_unique_ip(1) |> get(~p"/api/voice/turn-credentials")

    assert conn.status == 401
  end

  test "GET /api/voice/turn-credentials returns just a STUN entry when no TURN config is set",
       %{conn: conn} do
    # config/test.exs doesn't set :turn_config (nor does config.exs —
    # only config/runtime.exs's prod block does, from
    # METERED_TURN_USERNAME/METERED_TURN_CREDENTIAL), so this exercises
    # Backend.Turn's real not-configured fallback path, not a mock.
    assert Application.get_env(:backend, :turn_config) == nil

    user = user_fixture()

    conn =
      conn
      |> put_req_header("authorization", "Bearer #{token_for(user)}")
      |> with_unique_ip(2)
      |> get(~p"/api/voice/turn-credentials")

    assert json_response(conn, 200) == %{
             "ice_servers" => [%{"urls" => "stun:stun.relay.metered.ca:80"}]
           }
  end

  test "GET /api/voice/turn-credentials returns the full Metered TURN Server list when configured",
       %{conn: conn} do
    previous = Application.get_env(:backend, :turn_config)

    Application.put_env(:backend, :turn_config, %{
      username: "test-username",
      credential: "test-credential"
    })

    on_exit(fn -> Application.put_env(:backend, :turn_config, previous) end)

    user = user_fixture()

    conn =
      conn
      |> put_req_header("authorization", "Bearer #{token_for(user)}")
      |> with_unique_ip(3)
      |> get(~p"/api/voice/turn-credentials")

    assert json_response(conn, 200) == %{
             "ice_servers" => [
               %{"urls" => "stun:stun.relay.metered.ca:80"},
               %{
                 "urls" => "turn:global.relay.metered.ca:80",
                 "username" => "test-username",
                 "credential" => "test-credential"
               },
               %{
                 "urls" => "turn:global.relay.metered.ca:80?transport=tcp",
                 "username" => "test-username",
                 "credential" => "test-credential"
               },
               %{
                 "urls" => "turn:global.relay.metered.ca:443",
                 "username" => "test-username",
                 "credential" => "test-credential"
               },
               %{
                 "urls" => "turns:global.relay.metered.ca:443?transport=tcp",
                 "username" => "test-username",
                 "credential" => "test-credential"
               }
             ]
           }
  end
end
