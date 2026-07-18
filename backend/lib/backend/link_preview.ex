defmodule Backend.LinkPreview do
  @moduledoc """
  Fetches a URL's OpenGraph (falling back to plain `<title>`/`<meta
  name="description">`) metadata for chat link-preview cards. Deliberately
  simple — no HTML-parsing dependency (regex over the raw HTML is good
  enough for the well-formed `<meta>` tags real sites use for social
  sharing), and no server-side cache (each client caches per-URL in memory
  for its own session — see `useLinkPreview` on the frontend — so repeat
  views within one session don't re-fetch; a shared backend cache would be
  a reasonable future addition but isn't needed for this to work).
  """

  @timeout_ms 5_000
  @user_agent "Mozilla/5.0 (compatible; ZircleBot/1.0)"

  @doc """
  Returns `{:ok, %{url:, title:, description:, image:, site_name:}}` (any
  field may be `nil` if not present on the page) or `{:error, reason}`
  where reason is `:invalid_url` (bad scheme, missing host, or resolves to
  a private/loopback/link-local address — blocks SSRF against internal
  services) or `:fetch_failed`.
  """
  def fetch(url) do
    with {:ok, uri} <- parse_and_validate(url),
         {:ok, html} <- fetch_html(uri) do
      {:ok, extract_meta(html, url)}
    end
  end

  defp parse_and_validate(url) do
    uri = URI.parse(url)

    cond do
      uri.scheme not in ["http", "https"] -> {:error, :invalid_url}
      is_nil(uri.host) or uri.host == "" -> {:error, :invalid_url}
      not safe_host?(uri.host) -> {:error, :invalid_url}
      true -> {:ok, uri}
    end
  end

  # Blocks literal private/loopback/link-local IPs, and resolves hostnames
  # to catch the common case of a public-looking domain pointing at an
  # internal address. Not a full defense against DNS-rebinding (the actual
  # HTTP connection re-resolves and isn't pinned to the address checked
  # here), but blocks the straightforward SSRF attempts this endpoint would
  # otherwise be an easy target for.
  defp safe_host?(host) do
    charlist = String.to_charlist(host)

    case :inet.parse_address(charlist) do
      {:ok, ip} ->
        not private_ip?(ip)

      {:error, :einval} ->
        case :inet.gethostbyname(charlist) do
          {:ok, {:hostent, _, _, _, _, addresses}} -> Enum.all?(addresses, &(not private_ip?(&1)))
          {:error, _} -> false
        end
    end
  end

  defp private_ip?({127, _, _, _}), do: true
  defp private_ip?({10, _, _, _}), do: true
  defp private_ip?({172, b, _, _}) when b >= 16 and b <= 31, do: true
  defp private_ip?({192, 168, _, _}), do: true
  defp private_ip?({169, 254, _, _}), do: true
  defp private_ip?({0, 0, 0, 0}), do: true
  defp private_ip?({0, 0, 0, 0, 0, 0, 0, 1}), do: true

  defp private_ip?({0, 0, 0, 0, 0, 0xFFFF, hi, lo}) do
    # IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded v4 address too.
    private_ip?({div(hi, 256), rem(hi, 256), div(lo, 256), rem(lo, 256)})
  end

  defp private_ip?(_), do: false

  defp fetch_html(uri) do
    url = URI.to_string(uri)

    case Req.get(url, receive_timeout: @timeout_ms, headers: [{"user-agent", @user_agent}]) do
      {:ok, %Req.Response{status: status, body: body}}
      when status in 200..299 and is_binary(body) ->
        {:ok, body}

      _ ->
        {:error, :fetch_failed}
    end
  rescue
    _ -> {:error, :fetch_failed}
  end

  defp extract_meta(html, fallback_url) do
    %{
      url: fallback_url,
      title: find_meta(html, "og:title") || find_title_tag(html),
      description: find_meta(html, "og:description") || find_meta(html, "description"),
      image: find_meta(html, "og:image") |> resolve_url(fallback_url),
      site_name: find_meta(html, "og:site_name")
    }
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

  defp resolve_url(nil, _base), do: nil

  defp resolve_url(image, base) do
    case URI.parse(image) do
      %URI{scheme: nil} -> base |> URI.merge(image) |> URI.to_string()
      _ -> image
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

  defp codepoint_to_string(digits, base) do
    case Integer.parse(digits, base) do
      {code, ""} when code in 0..0x10FFFF -> <<code::utf8>>
      _ -> ""
    end
  end
end
