defmodule BackendWeb.RequireCloudflarePlugTest do
  use ExUnit.Case, async: false

  alias BackendWeb.RequireCloudflarePlug

  describe "when :cloudflare_origin_secret is unset (dev/test default)" do
    test "lets a request through with no x-origin-secret header" do
      conn = Plug.Test.conn(:get, "/") |> RequireCloudflarePlug.call([])

      refute conn.halted
      assert conn.status != 403
    end

    test "lets a request through even with an arbitrary x-origin-secret header" do
      conn =
        Plug.Test.conn(:get, "/")
        |> Plug.Conn.put_req_header("x-origin-secret", "whatever")
        |> RequireCloudflarePlug.call([])

      refute conn.halted
      assert conn.status != 403
    end
  end

  describe "when :cloudflare_origin_secret is set" do
    setup do
      original = Application.get_env(:backend, :cloudflare_origin_secret)
      Application.put_env(:backend, :cloudflare_origin_secret, "dev-secret")

      on_exit(fn ->
        if is_nil(original) do
          Application.delete_env(:backend, :cloudflare_origin_secret)
        else
          Application.put_env(:backend, :cloudflare_origin_secret, original)
        end
      end)

      :ok
    end

    test "passes through a request with the correct x-origin-secret header" do
      conn =
        Plug.Test.conn(:get, "/")
        |> Plug.Conn.put_req_header("x-origin-secret", "dev-secret")
        |> RequireCloudflarePlug.call([])

      refute conn.halted
    end

    test "halts with 403 and an empty body when the header is missing" do
      conn = Plug.Test.conn(:get, "/") |> RequireCloudflarePlug.call([])

      assert conn.halted
      assert conn.status == 403
      assert conn.resp_body == ""
    end

    test "halts with 403 when the header value is wrong" do
      conn =
        Plug.Test.conn(:get, "/")
        |> Plug.Conn.put_req_header("x-origin-secret", "wrong-secret")
        |> RequireCloudflarePlug.call([])

      assert conn.halted
      assert conn.status == 403
      assert conn.resp_body == ""
    end

    test "halts with 403 when the header is duplicated, even if one value is correct" do
      # Plug.Conn.put_req_header replaces rather than appends, so build the
      # multi-value header directly via the same req_headers list Plug and
      # Cowboy/Bandit would hand the plug for a repeated header.
      conn =
        Plug.Test.conn(:get, "/")
        |> Map.put(:req_headers, [
          {"x-origin-secret", "dev-secret"},
          {"x-origin-secret", "anything"}
        ])
        |> RequireCloudflarePlug.call([])

      # get_req_header/2 returns every value for a repeated header as a list
      # (e.g. ["dev-secret", "anything"]), and `call/2`'s `[^secret] ->`
      # clause only matches a *single*-element list equal to the secret — so
      # a duplicated header (whether from a misbehaving proxy or an attacker
      # trying to smuggle a second value past a WAF) is correctly rejected
      # rather than treated as a match. This is the intended behavior, not a
      # bug: it's confirmed here so a future refactor doesn't loosen it.
      assert conn.halted
      assert conn.status == 403
      assert conn.resp_body == ""
    end
  end
end
