defmodule BackendWeb.SecurityHeadersPlugTest do
  use BackendWeb.ConnCase, async: false

  @csp "default-src 'none'; img-src 'self'; frame-ancestors 'none'"

  describe "call/2 (unit)" do
    test "always sets nosniff, referrer-policy, x-frame-options, and CSP" do
      conn = Plug.Test.conn(:get, "/whatever") |> BackendWeb.SecurityHeadersPlug.call([])

      assert get_resp_header(conn, "x-content-type-options") == ["nosniff"]
      assert get_resp_header(conn, "referrer-policy") == ["strict-origin-when-cross-origin"]
      assert get_resp_header(conn, "x-frame-options") == ["DENY"]
      assert get_resp_header(conn, "content-security-policy") == [@csp]
    end

    test "does not set strict-transport-security outside :prod" do
      with_environment(:dev, fn ->
        conn = Plug.Test.conn(:get, "/whatever") |> BackendWeb.SecurityHeadersPlug.call([])
        assert get_resp_header(conn, "strict-transport-security") == []
      end)
    end

    test "sets strict-transport-security only in :prod" do
      with_environment(:prod, fn ->
        conn = Plug.Test.conn(:get, "/whatever") |> BackendWeb.SecurityHeadersPlug.call([])

        assert get_resp_header(conn, "strict-transport-security") ==
                 ["max-age=31536000; includeSubDomains"]
      end)
    end
  end

  describe "wired into the endpoint pipeline" do
    test "a JSON API response carries the security headers", %{conn: conn} do
      conn = get(conn, ~p"/api/servers")

      assert conn.status == 401
      assert get_resp_header(conn, "x-content-type-options") == ["nosniff"]
      assert get_resp_header(conn, "referrer-policy") == ["strict-origin-when-cross-origin"]
      assert get_resp_header(conn, "x-frame-options") == ["DENY"]
      assert get_resp_header(conn, "content-security-policy") == [@csp]
    end

    test "a Plug.Static-served file also carries the security headers", %{conn: conn} do
      conn = get(conn, "/robots.txt")

      assert conn.status == 200
      assert get_resp_header(conn, "x-content-type-options") == ["nosniff"]
      assert get_resp_header(conn, "referrer-policy") == ["strict-origin-when-cross-origin"]
      assert get_resp_header(conn, "x-frame-options") == ["DENY"]
      assert get_resp_header(conn, "content-security-policy") == [@csp]
    end

    test "HSTS is absent from real endpoint responses outside :prod", %{conn: conn} do
      with_environment(:dev, fn ->
        conn = get(conn, "/robots.txt")
        assert get_resp_header(conn, "strict-transport-security") == []
      end)
    end
  end

  defp with_environment(env, fun) do
    original = Application.get_env(:backend, :environment)
    Application.put_env(:backend, :environment, env)

    try do
      fun.()
    after
      Application.put_env(:backend, :environment, original)
    end
  end
end
