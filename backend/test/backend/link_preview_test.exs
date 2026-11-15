defmodule Backend.LinkPreviewTest do
  use ExUnit.Case, async: true

  alias Backend.LinkPreview
  alias Backend.LinkPreview.AddressPolicy

  describe "fetch/1 refuses URLs that could reach internal services" do
    for url <- [
          "http://127.0.0.1/",
          "http://localhost/",
          "http://10.0.0.5/",
          "http://172.16.0.1/",
          "http://192.168.1.1/",
          "http://169.254.169.254/latest/meta-data/",
          "http://100.100.100.200/",
          "http://0.0.0.0/",
          "http://[::1]/",
          "http://[::]/",
          "http://[::ffff:127.0.0.1]/",
          "http://[::ffff:169.254.169.254]/",
          "http://[64:ff9b::a9fe:a9fe]/",
          "http://[fd00::1]/",
          "http://[fe80::1]/"
        ] do
      test "#{url}" do
        assert LinkPreview.fetch(unquote(url)) == {:error, :invalid_url}
      end
    end
  end

  describe "fetch/1 refuses URLs outside the allowed shape" do
    for url <- [
          "ftp://example.com/",
          "file:///etc/passwd",
          "gopher://example.com/",
          "http:///nohost",
          "not a url",
          "http://user:pass@example.com/",
          "http://example.com:8080/",
          "https://example.com:6379/",
          ""
        ] do
      test "#{inspect(url)}" do
        assert LinkPreview.fetch(unquote(url)) == {:error, :invalid_url}
      end
    end

    test "non-string input" do
      assert LinkPreview.fetch(["http://example.com"]) == {:error, :invalid_url}
      assert LinkPreview.fetch(nil) == {:error, :invalid_url}
    end
  end

  test "a hostname is refused if ANY of its addresses is internal, not just the one used" do
    resolver = fn "mixed.test" -> {:ok, [{93, 184, 216, 34}, {10, 0, 0, 1}]} end

    assert LinkPreview.fetch("http://mixed.test/", resolver: resolver) == {:error, :invalid_url}
  end

  test "an unresolvable hostname is refused" do
    resolver = fn _ -> {:error, :nxdomain} end

    assert LinkPreview.fetch("http://nope.test/", resolver: resolver) == {:error, :invalid_url}
  end

  describe "fetching from a site (local stand-in)" do
    setup do
      server =
        start_supervised!(
          {Bandit,
           plug: Backend.LinkPreviewFakeSite,
           scheme: :http,
           ip: {127, 0, 0, 1},
           port: 0,
           startup_log: false}
        )

      {:ok, {_ip, port}} = ThousandIsland.listener_info(server)

      # "site.test" stands in for a public website; it really lives on
      # loopback, so exactly that one address is let through. Everything
      # else still goes through the real policy and real IP parsing.
      opts = [
        resolver: fn
          "site.test" ->
            {:ok, [{127, 0, 0, 1}]}

          host ->
            case :inet.parse_strict_address(String.to_charlist(host)) do
              {:ok, ip} -> {:ok, [ip]}
              _ -> {:error, :nxdomain}
            end
        end,
        address_allowed?: fn
          {127, 0, 0, 1} -> true
          ip -> AddressPolicy.public?(ip)
        end,
        allowed_ports: [port, 80]
      ]

      %{base: "http://site.test:#{port}", opts: opts}
    end

    test "returns the page's OpenGraph metadata", %{base: base, opts: opts} do
      assert {:ok, preview} = LinkPreview.fetch(base <> "/ok", opts)

      assert preview == %{
               url: base <> "/ok",
               title: "Zircle & Arkadaşlar",
               description: "Açıklama",
               image: base <> "/kapak.png",
               site_name: "Test Sitesi"
             }
    end

    test "follows a redirect that stays public, keeping the URL that was asked for",
         %{base: base, opts: opts} do
      assert {:ok, %{url: url, title: "Zircle & Arkadaşlar", image: image}} =
               LinkPreview.fetch(base <> "/redirect-relative", opts)

      assert url == base <> "/redirect-relative"
      assert image == base <> "/kapak.png"
    end

    test "refuses a public page that redirects to the cloud metadata address",
         %{base: base, opts: opts} do
      assert LinkPreview.fetch(base <> "/redirect-internal", opts) == {:error, :invalid_url}
    end

    test "refuses a redirect to a disallowed port", %{base: base, opts: opts} do
      assert LinkPreview.fetch(base <> "/redirect-other-port", opts) == {:error, :invalid_url}
    end

    test "gives up on a redirect loop", %{base: base, opts: opts} do
      assert LinkPreview.fetch(base <> "/redirect-loop", opts) == {:error, :fetch_failed}
    end

    test "fails on a redirect without a Location", %{base: base, opts: opts} do
      assert LinkPreview.fetch(base <> "/redirect-no-location", opts) == {:error, :fetch_failed}
    end

    test "doesn't read non-HTML responses", %{base: base, opts: opts} do
      assert LinkPreview.fetch(base <> "/not-html", opts) == {:error, :fetch_failed}
    end

    test "fails on an error status", %{base: base, opts: opts} do
      assert LinkPreview.fetch(base <> "/error", opts) == {:error, :fetch_failed}
    end

    test "stops reading a huge body at the cap instead of downloading all of it",
         %{base: base, opts: opts} do
      # The page is 5 MB; og:title is at the very start, og:description
      # only ~2 MB in — past the 1 MB cap, so it must never be seen.
      assert {:ok, %{title: "Başta", description: nil}} =
               LinkPreview.fetch(base <> "/huge", opts)
    end

    test "gives up at the deadline on a slow site", %{base: base, opts: opts} do
      {elapsed_us, result} =
        :timer.tc(fn -> LinkPreview.fetch(base <> "/slow", opts ++ [deadline_ms: 300]) end)

      assert result == {:error, :fetch_failed}
      assert elapsed_us < 1_500_000
    end

    test "survives unencodable entities and drops non-http(s) images",
         %{base: base, opts: opts} do
      assert {:ok, %{title: "abc", image: nil}} =
               LinkPreview.fetch(base <> "/bad-entities", opts)
    end
  end
end
