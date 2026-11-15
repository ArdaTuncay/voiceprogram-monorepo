defmodule Backend.TurnTest do
  # :metered_api/:turn_config are global application env that these tests
  # override — not safe to run concurrently with each other.
  use Backend.DataCase, async: false

  import ExUnit.CaptureLog

  alias Backend.MeteredStub
  alias Backend.Turn
  alias Backend.Turn.Credential

  @stun %{urls: "stun:stun.relay.metered.ca:80"}

  describe "without per-user Metered config (static / STUN-only fallback)" do
    setup do
      previous = {
        Application.get_env(:backend, :metered_api),
        Application.get_env(:backend, :turn_config)
      }

      Application.delete_env(:backend, :metered_api)

      on_exit(fn ->
        {metered, turn} = previous
        if metered, do: Application.put_env(:backend, :metered_api, metered)
        Application.put_env(:backend, :turn_config, turn)
      end)

      %{user_id: Ecto.UUID.generate()}
    end

    test "returns just a STUN entry when nothing is configured", %{user_id: user_id} do
      Application.delete_env(:backend, :turn_config)

      assert {{:ok, [@stun]}, _log} = with_log(fn -> Turn.fetch_ice_servers(user_id) end)
    end

    test "returns just a STUN entry when the static pair is blank or half-set", %{
      user_id: user_id
    } do
      for config <- [%{username: "", credential: ""}, %{username: "u", credential: nil}] do
        Application.put_env(:backend, :turn_config, config)
        assert {{:ok, [@stun]}, _log} = with_log(fn -> Turn.fetch_ice_servers(user_id) end)
      end
    end

    test "returns the static credential on all four relay URLs, with a warning", %{
      user_id: user_id
    } do
      Application.put_env(:backend, :turn_config, %{username: "u", credential: "c"})

      {result, log} = with_log(fn -> Turn.fetch_ice_servers(user_id) end)

      assert result ==
               {:ok,
                [
                  @stun,
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

      assert log =~ "statik parola"
    end

    test "prewarm/1 does nothing", %{user_id: user_id} do
      assert Turn.prewarm(user_id) == :ok
      assert Repo.all(Credential) == []
    end
  end

  describe "per-user Metered credentials" do
    setup do
      MeteredStub.configure()
      %{user: user_fixture()}
    end

    test "the first call creates a 48 h credential labelled with the user id", %{user: user} do
      MeteredStub.stub_ok()

      assert {:ok, [@stun | servers]} = Turn.fetch_ice_servers(user.id)

      assert_received {:metered_create, "zircle-test.metered.live", query, body}
      assert query == %{"secretKey" => MeteredStub.secret_key()}
      assert body == %{"expiryInSeconds" => 172_800, "label" => user.id}

      stored = Repo.get_by!(Credential, user_id: user.id)
      assert servers == MeteredStub.servers_for(stored.metered_username)
      assert stored.ice_servers == servers

      seconds_left = DateTime.diff(stored.expires_at, DateTime.utc_now())
      assert seconds_left in (172_800 - 120)..172_800
    end

    test "a fresh credential is reused without calling Metered again", %{user: user} do
      MeteredStub.stub_ok()

      {:ok, first} = Turn.fetch_ice_servers(user.id)
      assert_received {:metered_create, _, _, _}

      assert {:ok, ^first} = Turn.fetch_ice_servers(user.id)
      refute_received {:metered_create, _, _, _}
    end

    test "each user gets their own credential", %{user: user} do
      MeteredStub.stub_ok()
      other = user_fixture()

      {:ok, mine} = Turn.fetch_ice_servers(user.id)
      {:ok, theirs} = Turn.fetch_ice_servers(other.id)

      assert mine != theirs
    end

    test "past half its lifetime: still handed out, and replaced in the background", %{
      user: user
    } do
      MeteredStub.stub_ok()
      old = insert_credential(user, hours_left: 10)

      assert {:ok, [@stun | servers]} = Turn.fetch_ice_servers(user.id)
      assert servers == old.ice_servers

      assert_received {:metered_create, _, _, _}
      assert Repo.get_by!(Credential, user_id: user.id).metered_username != old.metered_username
    end

    test "with under an hour left: a new one is issued, and the old entries go along with it",
         %{user: user} do
      MeteredStub.stub_ok()
      old = insert_credential(user, hours_left: 0.5)

      assert {:ok, [@stun | servers]} = Turn.fetch_ice_servers(user.id)

      new = Repo.get_by!(Credential, user_id: user.id)
      assert servers == MeteredStub.servers_for(new.metered_username) ++ old.ice_servers
    end

    test "an expired credential is replaced and never handed out", %{user: user} do
      MeteredStub.stub_ok()
      old = insert_credential(user, hours_left: -1)

      assert {:ok, [@stun | servers]} = Turn.fetch_ice_servers(user.id)

      new = Repo.get_by!(Credential, user_id: user.id)
      assert servers == MeteredStub.servers_for(new.metered_username)
      refute Enum.any?(servers, &(&1 in old.ice_servers))
    end

    test "a Metered outage falls back to the static pair, without logging the secret key" do
      MeteredStub.configure(static: true)
      MeteredStub.stub_failing(500, %{"message" => "boom"})
      user = user_fixture()

      {result, log} = with_log(fn -> Turn.fetch_ice_servers(user.id) end)

      assert {:ok, [@stun | servers]} = result
      assert Enum.all?(servers, &(&1.username == "static-u"))
      assert log =~ "oluşturulamadı"
      refute log =~ MeteredStub.secret_key()
      assert Repo.all(Credential) == []
    end

    test "a Metered outage with no static pair degrades to STUN only", %{user: user} do
      MeteredStub.stub_failing(400, %{"message" => "Not subscribed to any turn server plan"})

      assert {{:ok, [@stun]}, _log} = with_log(fn -> Turn.fetch_ice_servers(user.id) end)
    end

    test "an unexpected Metered response is treated as a failure", %{user: user} do
      Req.Test.stub(Backend.Turn.Metered, fn conn -> Req.Test.json(conn, %{"nope" => true}) end)

      {result, log} = with_log(fn -> Turn.fetch_ice_servers(user.id) end)

      assert result == {:ok, [@stun]}
      assert log =~ "unexpected_response"
      assert Repo.all(Credential) == []
    end

    test "prewarm/1 creates a missing credential and leaves a fresh one alone", %{user: user} do
      MeteredStub.stub_ok()

      assert Turn.prewarm(user.id) == :ok
      assert_received {:metered_create, _, _, _}
      created = Repo.get_by!(Credential, user_id: user.id)

      assert Turn.prewarm(user.id) == :ok
      refute_received {:metered_create, _, _, _}

      assert Repo.get_by!(Credential, user_id: user.id).metered_username ==
               created.metered_username
    end
  end

  defp insert_credential(user, hours_left: hours) do
    expires_at =
      DateTime.utc_now()
      |> DateTime.add(round(hours * 3600), :second)
      |> DateTime.truncate(:second)

    Repo.insert!(%Credential{
      user_id: user.id,
      metered_username: "old-user",
      ice_servers: [
        %{
          "urls" => "turn:standard.relay.metered.ca:80",
          "username" => "old-user",
          "credential" => "old-pass"
        }
      ],
      expires_at: expires_at
    })
  end
end
