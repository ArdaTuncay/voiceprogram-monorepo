defmodule Backend.TurnTest do
  # Application.get_env(:backend, :turn_config) is global, process-
  # independent state each test here temporarily overrides — not safe to
  # run concurrently with itself.
  use ExUnit.Case, async: false

  alias Backend.Turn

  setup do
    previous = Application.get_env(:backend, :turn_config)
    on_exit(fn -> Application.put_env(:backend, :turn_config, previous) end)
    :ok
  end

  test "returns just a STUN entry when :turn_config isn't set" do
    Application.delete_env(:backend, :turn_config)

    assert Turn.fetch_ice_servers() == {:ok, [%{urls: "stun:stun.relay.metered.ca:80"}]}
  end

  test "returns just a STUN entry when :turn_config has blank username/credential" do
    Application.put_env(:backend, :turn_config, %{username: "", credential: ""})

    assert Turn.fetch_ice_servers() == {:ok, [%{urls: "stun:stun.relay.metered.ca:80"}]}
  end

  test "returns just a STUN entry when :turn_config is only half-set (e.g. one prod env var missing)" do
    Application.put_env(:backend, :turn_config, %{username: "u", credential: nil})

    assert Turn.fetch_ice_servers() == {:ok, [%{urls: "stun:stun.relay.metered.ca:80"}]}
  end

  test "returns Metered's STUN entry plus all 4 TURN Server URLs, credentialed, when configured" do
    Application.put_env(:backend, :turn_config, %{username: "u", credential: "c"})

    assert Turn.fetch_ice_servers() ==
             {:ok,
              [
                %{urls: "stun:stun.relay.metered.ca:80"},
                %{urls: "turn:global.relay.metered.ca:80", username: "u", credential: "c"},
                %{
                  urls: "turn:global.relay.metered.ca:80?transport=tcp",
                  username: "u",
                  credential: "c"
                },
                %{urls: "turn:global.relay.metered.ca:443", username: "u", credential: "c"},
                %{
                  urls: "turns:global.relay.metered.ca:443?transport=tcp",
                  username: "u",
                  credential: "c"
                }
              ]}
  end
end
