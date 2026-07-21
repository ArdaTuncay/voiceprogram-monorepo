defmodule Backend.RepoTest do
  # Pure config transformation, no shared/global state to isolate — safe
  # to run concurrently.
  use ExUnit.Case, async: true

  alias Backend.Repo

  describe "init/2" do
    test "adds an HTTPS-profile customize_hostname_check when ssl_opts has verify: :verify_peer" do
      config = [
        ssl: true,
        ssl_opts: [
          verify: :verify_peer,
          server_name_indication: ~c"dpg-d9608d8js32c7396u8b0-a.frankfurt-postgres.render.com"
        ],
        url: "ecto://user:pass@host/db"
      ]

      assert {:ok, updated} = Repo.init(:supervisor, config)

      assert Keyword.get(updated[:ssl_opts], :customize_hostname_check) ==
               [match_fun: :public_key.pkix_verify_hostname_match_fun(:https)]

      # Nothing else in ssl_opts (or the rest of the config) is disturbed.
      assert Keyword.get(updated[:ssl_opts], :verify) == :verify_peer
      assert Keyword.get(updated[:ssl_opts], :server_name_indication)
      assert Keyword.get(updated, :url) == "ecto://user:pass@host/db"
    end

    test "leaves ssl_opts untouched when verify: :verify_none (DATABASE_SSL_VERIFY=verify_none)" do
      config = [ssl: true, ssl_opts: [verify: :verify_none]]

      assert {:ok, updated} = Repo.init(:supervisor, config)
      assert updated[:ssl_opts] == [verify: :verify_none]
    end

    test "leaves config untouched when there's no :ssl_opts at all (dev/test)" do
      config = [username: "postgres", password: "postgres", database: "backend_dev"]

      assert {:ok, updated} = Repo.init(:supervisor, config)
      assert updated == config
    end

    test "works the same for the :runtime context (Ecto also invokes init/2 this way)" do
      config = [ssl_opts: [verify: :verify_peer]]

      assert {:ok, updated} = Repo.init(:runtime, config)
      assert Keyword.has_key?(updated[:ssl_opts], :customize_hostname_check)
    end
  end
end
