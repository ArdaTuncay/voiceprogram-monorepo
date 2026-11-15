defmodule Backend.LinkPreview do
  @max_redirects 3
  @max_body_bytes 1_000_000
  @deadline_ms 8_000
  @connect_timeout_ms 3_000
  @dns_timeout_ms 3_000
  @default_ports %{"http" => 80, "https" => 443}
  @user_agent "Mozilla/5.0 (compatible; ZircleBot/1.0)"
  @request_headers [
    {"user-agent", @user_agent},
    {"accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"},
    # Asked for uncompressed on purpose: @max_body_bytes caps what's read
    # off the wire, and a compressed body could expand far past it.
    {"accept-encoding", "identity"}
  ]
  @max_lengths %{title: 300, description: 500, site_name: 100, image: 2_048}

  @moduledoc """
  Fetches a URL's OpenGraph (falling back to plain `<title>`/`<meta
  name="description">`) metadata for chat link-preview cards.

  This is the one place the server makes an outbound HTTP request to a URL
  a user picked, so it is written against SSRF (making the server reach
  something on its own network on an attacker's behalf):

    * Only `http`/`https`, only on their default ports, no credentials in
      the URL.
    * The hostname is resolved once (A and AAAA) and *every* address it
      resolves to must pass `Backend.LinkPreview.AddressPolicy`. The
      connection then goes to that already-checked IP; the hostname is only
      used for the `Host` header and TLS (SNI and certificate verification).
      A DNS answer that changes between the check and the connect (DNS
      rebinding) therefore can't steer it to an internal address.
    * Redirects are followed by hand, at most #{@max_redirects}, and every
      hop goes through the same checks — a public page can't bounce the
      request to `169.254.169.254` or `localhost`.
    * Only HTML responses are read, uncompressed, and reading stops at
      #{@max_body_bytes} bytes — a huge or endless response can't exhaust
      memory.
    * One #{@deadline_ms} ms deadline covers DNS, connecting, every redirect
      hop and the body.

  Uses Mint (the HTTP client underneath Req) directly rather than Req:
  pinning a connection to a checked IP needs Mint's per-connection
  `:hostname` option, and Req only exposes that through `:connect_options`,
  which starts a new Finch pool — and creates a new atom — for every
  distinct option set, never stopping them. Here that would be one per
  previewed hostname.

  No HTML-parsing dependency (regex over the raw HTML is good enough for
  the well-formed `<meta>` tags real sites use for social sharing), and no
  server-side cache (each client caches per-URL for its session — see
  `useLinkPreview` on the frontend).
  """

  alias Backend.LinkPreview.AddressPolicy

  @type preview :: %{
          url: String.t(),
          title: String.t() | nil,
          description: String.t() | nil,
          image: String.t() | nil,
          site_name: String.t() | nil
        }

  @doc """
  Returns `{:ok, preview}` (any field but `:url` may be `nil`) or
  `{:error, reason}`, where reason is `:invalid_url` (not an allowed URL, or
  it — or a redirect it led to — points at a non-public address) or
  `:fetch_failed` (unreachable, not HTML, too many redirects, timed out).

  `opts` exist for tests only, to point the fetcher at a local test server
  that the real policy would (correctly) refuse:

    * `:resolver` — `(host -> {:ok, [ip]} | {:error, term})`
    * `:address_allowed?` — `(ip -> boolean)`, default `AddressPolicy.public?/1`
    * `:allowed_ports` — default: 80 for http, 443 for https
    * `:deadline_ms` — default #{@deadline_ms}
  """
  @spec fetch(term(), keyword()) :: {:ok, preview()} | {:error, :invalid_url | :fetch_failed}
  def fetch(url, opts \\ []) do
    ctx = %{
      resolver: Keyword.get(opts, :resolver, &resolve/1),
      address_allowed?: Keyword.get(opts, :address_allowed?, &AddressPolicy.public?/1),
      allowed_ports: Keyword.get(opts, :allowed_ports),
      deadline:
        System.monotonic_time(:millisecond) + Keyword.get(opts, :deadline_ms, @deadline_ms)
    }

    with {:ok, uri} <- validate_url(url, ctx),
         {:ok, html, final_uri} <- follow(uri, @max_redirects, ctx) do
      {:ok, extract_meta(html, url, final_uri)}
    end
  end

  # -- URL and address checks -------------------------------------------------

  defp validate_url(url, ctx) when is_binary(url) do
    case URI.parse(url) do
      %URI{scheme: scheme, host: host, userinfo: nil} = uri
      when scheme in ["http", "https"] and is_binary(host) and host != "" ->
        if port_allowed?(uri, ctx), do: {:ok, uri}, else: {:error, :invalid_url}

      _ ->
        {:error, :invalid_url}
    end
  end

  defp validate_url(_url, _ctx), do: {:error, :invalid_url}

  defp port_allowed?(%URI{port: port}, %{allowed_ports: ports}) when is_list(ports),
    do: port in ports

  defp port_allowed?(%URI{scheme: scheme, port: port}, _ctx),
    do: port == Map.fetch!(@default_ports, scheme)

  # Every address the name resolves to has to be public, not just the one
  # we'd connect to — a name that mixes public and internal answers is
  # exactly what a rebinding setup looks like.
  defp resolve_allowed(host, ctx) do
    case ctx.resolver.(host) do
      {:ok, [_ | _] = ips} ->
        if Enum.all?(ips, ctx.address_allowed?),
          do: {:ok, prefer_ipv4(ips)},
          else: {:error, :invalid_url}

      _ ->
        {:error, :invalid_url}
    end
  end

  defp prefer_ipv4(ips), do: Enum.find(ips, &(tuple_size(&1) == 4)) || hd(ips)

  defp resolve(host) do
    charlist = String.to_charlist(host)

    case :inet.parse_strict_address(charlist) do
      {:ok, ip} ->
        {:ok, [ip]}

      {:error, _} ->
        ips =
          for family <- [:inet, :inet6],
              {:ok, found} <- [:inet.getaddrs(charlist, family, @dns_timeout_ms)],
              ip <- found,
              uniq: true,
              do: ip

        if ips == [], do: {:error, :nxdomain}, else: {:ok, ips}
    end
  rescue
    # A host with characters a charlist resolver can't take (e.g. an
    # unencoded IDN) — treat like any other unresolvable name.
    ArgumentError -> {:error, :nxdomain}
  end

  # -- Fetching -----------------------------------------------------------------

  defp follow(uri, redirects_left, ctx) do
    with {:ok, ip} <- resolve_allowed(uri.host, ctx) do
      case get(uri, ip, ctx) do
        {:ok, html} ->
          {:ok, html, uri}

        {:redirect, location} when redirects_left > 0 ->
          follow_redirect(uri, location, redirects_left, ctx)

        {:redirect, _location} ->
          {:error, :fetch_failed}

        {:error, _reason} = error ->
          error
      end
    end
  end

  defp follow_redirect(uri, location, redirects_left, ctx) do
    with {:ok, next} <- validate_url(uri |> URI.merge(location) |> URI.to_string(), ctx) do
      follow(next, redirects_left - 1, ctx)
    end
  end

  defp get(uri, ip, ctx) do
    with {:ok, timeout} <- time_left(ctx),
         {:ok, conn} <-
           Mint.HTTP.connect(scheme_atom(uri.scheme), ip, uri.port,
             hostname: uri.host,
             mode: :passive,
             protocols: [:http1],
             transport_opts: [timeout: min(timeout, @connect_timeout_ms)]
           ) do
      {result, conn} = request(conn, uri, ctx)
      Mint.HTTP.close(conn)
      result
    else
      _ -> {:error, :fetch_failed}
    end
  end

  defp scheme_atom("http"), do: :http
  defp scheme_atom("https"), do: :https

  defp request(conn, uri, ctx) do
    case Mint.HTTP.request(conn, "GET", request_target(uri), @request_headers, nil) do
      {:ok, conn, ref} ->
        read_response(conn, ref, %{status: nil, headers: nil, body: [], size: 0}, ctx)

      {:error, conn, _reason} ->
        {{:error, :fetch_failed}, conn}
    end
  end

  # Percent-encodes only what can't go on the request line as-is (spaces,
  # control and non-ASCII characters), leaving existing %XX escapes alone.
  defp request_target(%URI{path: path, query: query}) do
    target = if path in [nil, ""], do: "/", else: path
    target = if query, do: target <> "?" <> query, else: target
    URI.encode(target, &(&1 > 0x20 and &1 < 0x7F))
  end

  defp read_response(conn, ref, acc, ctx) do
    with {:ok, timeout} <- time_left(ctx),
         {:ok, conn, responses} <- Mint.HTTP.recv(conn, 0, timeout) do
      acc = Enum.reduce(responses, acc, &collect(&1, &2, ref))

      if acc[:done] || stop_reading?(acc),
        do: {finish(acc), conn},
        else: read_response(conn, ref, acc, ctx)
    else
      {:error, :deadline} ->
        {{:error, :fetch_failed}, conn}

      # The peer closed or reset mid-response: whatever arrived is still
      # usable (an HTML <head> usually comes first), so judge that.
      {:error, conn, _reason, responses} ->
        acc = Enum.reduce(responses, acc, &collect(&1, &2, ref))
        {if(acc.headers, do: finish(acc), else: {:error, :fetch_failed}), conn}
    end
  end

  defp collect({:status, ref, status}, acc, ref), do: %{acc | status: status}
  defp collect({:headers, ref, headers}, acc, ref), do: %{acc | headers: headers}

  defp collect({:data, ref, data}, acc, ref),
    do: %{acc | body: [acc.body, data], size: acc.size + byte_size(data)}

  defp collect({:done, ref}, acc, ref), do: Map.put(acc, :done, true)
  defp collect(_other, acc, _ref), do: acc

  # Redirects and errors need nothing past their headers; non-HTML bodies
  # are never read; HTML is read up to @max_body_bytes.
  defp stop_reading?(%{headers: nil}), do: false
  defp stop_reading?(%{status: status}) when status not in 200..299, do: true
  defp stop_reading?(acc), do: not html?(acc.headers) or acc.size >= @max_body_bytes

  defp finish(%{status: status, headers: headers}) when status in 300..399 do
    case header(headers, "location") do
      nil -> {:error, :fetch_failed}
      location -> {:redirect, location}
    end
  end

  defp finish(%{status: status} = acc) when status in 200..299 do
    if html?(acc.headers) do
      body = IO.iodata_to_binary(acc.body)
      {:ok, binary_part(body, 0, min(byte_size(body), @max_body_bytes))}
    else
      {:error, :fetch_failed}
    end
  end

  defp finish(_acc), do: {:error, :fetch_failed}

  defp html?(headers) do
    case header(headers, "content-type") do
      nil ->
        false

      value ->
        value = String.downcase(value)

        String.starts_with?(value, "text/html") or
          String.starts_with?(value, "application/xhtml+xml")
    end
  end

  defp header(headers, name) do
    Enum.find_value(headers, fn {key, value} -> if String.downcase(key) == name, do: value end)
  end

  defp time_left(%{deadline: deadline}) do
    case deadline - System.monotonic_time(:millisecond) do
      left when left > 0 -> {:ok, left}
      _ -> {:error, :deadline}
    end
  end

  # -- Metadata extraction ------------------------------------------------------

  defp extract_meta(html, original_url, final_uri) do
    %{
      url: original_url,
      title: clean(find_meta(html, "og:title") || find_title_tag(html), :title),
      description:
        clean(find_meta(html, "og:description") || find_meta(html, "description"), :description),
      image: html |> find_meta("og:image") |> resolve_image(final_uri) |> clean(:image),
      site_name: clean(find_meta(html, "og:site_name"), :site_name)
    }
  end

  # Pages aren't always UTF-8 and some are huge; what goes back to clients
  # (and through Jason) must be valid UTF-8 and of reasonable size.
  defp clean(nil, _field), do: nil

  defp clean(value, field) do
    value |> String.replace_invalid() |> String.slice(0, Map.fetch!(@max_lengths, field))
  end

  defp find_meta(html, property) do
    escaped = Regex.escape(property)

    patterns = [
      ~r/<meta[^>]+(?:property|name)=["']#{escaped}["'][^>]+content=["']([^"']*)["']/i,
      ~r/<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']#{escaped}["']/i
    ]

    Enum.find_value(patterns, fn pattern ->
      case Regex.run(pattern, html) do
        [_, value] -> value |> unescape_html() |> String.trim() |> presence()
        _ -> nil
      end
    end)
  end

  defp find_title_tag(html) do
    case Regex.run(~r/<title[^>]*>([^<]*)<\/title>/i, html) do
      [_, title] -> title |> unescape_html() |> String.trim() |> presence()
      _ -> nil
    end
  end

  defp presence(""), do: nil
  defp presence(value), do: value

  # Relative og:image URLs are resolved against the page they came from
  # (the final URL after redirects). Only http(s) results are kept — the
  # client puts this straight into an <img src>.
  defp resolve_image(nil, _base), do: nil

  defp resolve_image(image, %URI{} = base) do
    case URI.merge(base, image) do
      %URI{scheme: scheme} = uri when scheme in ["http", "https"] -> URI.to_string(uri)
      _ -> nil
    end
  end

  defp unescape_html(text) do
    text
    |> String.replace("&amp;", "&")
    |> String.replace("&lt;", "<")
    |> String.replace("&gt;", ">")
    |> String.replace("&quot;", "\"")
    |> String.replace("&#39;", "'")
    |> String.replace("&apos;", "'")
    |> then(
      &Regex.replace(~r/&#x([0-9a-fA-F]+);/, &1, fn _, hex -> codepoint_to_string(hex, 16) end)
    )
    |> then(&Regex.replace(~r/&#(\d+);/, &1, fn _, dec -> codepoint_to_string(dec, 10) end))
  end

  # Surrogates (U+D800–U+DFFF) aren't encodable as UTF-8 — `<<code::utf8>>`
  # raises on them, which used to crash the whole request on a page
  # containing e.g. `&#xD800;`.
  defp codepoint_to_string(digits, base) do
    case Integer.parse(digits, base) do
      {code, ""} when code in 0..0xD7FF or code in 0xE000..0x10FFFF -> <<code::utf8>>
      _ -> ""
    end
  end
end
