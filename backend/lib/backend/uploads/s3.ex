defmodule Backend.Uploads.S3 do
  @moduledoc """
  Stores and reads files in an S3-compatible object store (AWS S3,
  Cloudflare R2, DigitalOcean Spaces, ...) via hand-rolled SigV4-signed
  requests.

  No `ex_aws`/`ex_aws_s3` dependency needed — just `Req` (already a
  dependency, used elsewhere) for the HTTP call and `:crypto` for the
  signature. R2 and Spaces both speak the same SigV4 scheme as S3, so this
  one signer covers all three; only `config :backend, :uploads` differs
  (see config/runtime.exs).

  Public files are written at the bucket root and linked to directly by
  their public URL. Private (DM) files live under `private/` and are only
  ever read back here, by the backend (see `Backend.Uploads.read_private/1`),
  so their keys never reach a client.
  """

  require Logger

  @doc """
  Uploads `path`'s contents as `key` with the given content type.

  `extra_headers` are stored with the object and sent back whenever it's
  fetched — `Backend.Uploads` uses this for `content-disposition`, so
  documents download under their original name. They're signed like the
  rest.

  Returns `{:ok, public_url}` or `{:error, reason}`.
  """
  def upload(path, key, content_type, extra_headers \\ []) do
    config = Application.fetch_env!(:backend, :uploads)
    headers = [{"content-type", content_type} | extra_headers]

    case request(config, :put, key, File.read!(path), headers) do
      {:ok, %Req.Response{status: status}} when status in 200..299 ->
        {:ok, public_url(config, Keyword.fetch!(config, :bucket), key)}

      {:ok, %Req.Response{status: status, body: resp_body}} ->
        Logger.error("S3 upload failed (#{status}): #{inspect(resp_body)}")
        {:error, :s3_upload_failed}

      {:error, reason} ->
        Logger.error("S3 upload request error: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc "Reads `key`'s contents: `{:ok, body}`, `{:error, :not_found}` or `{:error, reason}`."
  def download(key) do
    config = Application.fetch_env!(:backend, :uploads)

    case request(config, :get, key, "", []) do
      {:ok, %Req.Response{status: 200, body: body}} ->
        {:ok, body}

      {:ok, %Req.Response{status: status}} when status in [403, 404] ->
        {:error, :not_found}

      {:ok, %Req.Response{status: status, body: resp_body}} ->
        Logger.error("S3 download failed (#{status}): #{inspect(resp_body)}")
        {:error, :s3_download_failed}

      {:error, reason} ->
        Logger.error("S3 download request error: #{inspect(reason)}")
        {:error, reason}
    end
  end

  defp request(config, method, key, body, extra_headers) do
    bucket = Keyword.fetch!(config, :bucket)
    region = Keyword.get(config, :region, "auto")
    access_key_id = Keyword.fetch!(config, :access_key_id)
    secret_access_key = Keyword.fetch!(config, :secret_access_key)

    %{host: host, uri_path: uri_path} = endpoint_parts(config, bucket, key)

    now = DateTime.utc_now()
    amz_date = Calendar.strftime(now, "%Y%m%dT%H%M%SZ")
    date_stamp = Calendar.strftime(now, "%Y%m%d")
    payload_hash = sha256_hex(body)

    headers =
      Map.merge(Map.new(extra_headers), %{
        "host" => host,
        "x-amz-content-sha256" => payload_hash,
        "x-amz-date" => amz_date
      })

    verb = method |> Atom.to_string() |> String.upcase()

    authorization =
      authorization(%{
        method: verb,
        uri_path: uri_path,
        headers: headers,
        payload_hash: payload_hash,
        region: region,
        access_key_id: access_key_id,
        secret_access_key: secret_access_key,
        amz_date: amz_date,
        date_stamp: date_stamp
      })

    # Bodies are files, not JSON — never let Req decode them.
    Req.request(
      [
        method: method,
        url: "https://#{host}#{uri_path}",
        body: body,
        headers: Map.to_list(headers) ++ [{"authorization", authorization}],
        decode_body: false
      ] ++ req_options()
    )
  end

  @doc false
  # The SigV4 `Authorization` header for one request — pure, so it can be
  # checked against AWS's published example signatures (see s3_test.exs).
  # `headers` must already include host, x-amz-content-sha256 and x-amz-date.
  def authorization(%{} = req) do
    {signed_headers, canonical_headers} = canonical_headers(req.headers)

    # canonical_headers already ends every line with a newline; the
    # canonical request then has exactly one more newline before the signed
    # header list. (An extra blank line here made every real S3/R2 request
    # fail with 403 SignatureDoesNotMatch.)
    canonical_request =
      Enum.join(
        [req.method, req.uri_path, "", canonical_headers, signed_headers, req.payload_hash],
        "\n"
      )

    credential_scope = "#{req.date_stamp}/#{req.region}/s3/aws4_request"

    string_to_sign =
      Enum.join(
        ["AWS4-HMAC-SHA256", req.amz_date, credential_scope, sha256_hex(canonical_request)],
        "\n"
      )

    signature =
      req.secret_access_key
      |> signing_key(req.date_stamp, req.region)
      |> hmac_hex(string_to_sign)

    "AWS4-HMAC-SHA256 Credential=#{req.access_key_id}/#{credential_scope}, " <>
      "SignedHeaders=#{signed_headers}, Signature=#{signature}"
  end

  # Test-only seam: config/test.exs routes these through Req.Test.
  defp req_options,
    do: Keyword.get(Application.get_env(:backend, __MODULE__, []), :req_options, [])

  # Path-style addressing (works uniformly for AWS S3, R2, and Spaces) when
  # a custom `:endpoint` is configured; falls back to AWS's own
  # virtual-hosted-style host when it isn't (plain AWS S3, no endpoint override).
  defp endpoint_parts(config, bucket, key) do
    case Keyword.get(config, :endpoint) do
      nil ->
        region = Keyword.fetch!(config, :region)
        %{host: "#{bucket}.s3.#{region}.amazonaws.com", uri_path: "/#{key}"}

      endpoint ->
        uri = URI.parse(endpoint)
        %{host: uri.host, uri_path: "/#{bucket}/#{key}"}
    end
  end

  @doc """
  The part of every public URL `upload/4` returns that comes before the
  object key (e.g. `"https://pub-xxx.r2.dev/"`), or `nil` when S3 isn't
  configured. Used by `Backend.Uploads.own_file_url?/1`.
  """
  def public_url_prefix do
    config = Application.get_env(:backend, :uploads, [])

    case Keyword.get(config, :bucket) do
      nil -> nil
      bucket -> public_url(config, bucket, "")
    end
  end

  defp public_url(config, bucket, key) do
    case Keyword.get(config, :public_url_base) do
      nil ->
        %{host: host, uri_path: uri_path} = endpoint_parts(config, bucket, key)
        "https://#{host}#{uri_path}"

      base ->
        String.trim_trailing(base, "/") <> "/" <> key
    end
  end

  defp canonical_headers(headers) do
    sorted =
      headers
      |> Enum.map(fn {k, v} -> {String.downcase(k), String.trim(v)} end)
      |> Enum.sort()

    signed_headers = sorted |> Enum.map_join(";", &elem(&1, 0))
    canonical = sorted |> Enum.map_join(fn {k, v} -> "#{k}:#{v}\n" end)
    {signed_headers, canonical}
  end

  defp sha256_hex(data), do: :sha256 |> :crypto.hash(data) |> Base.encode16(case: :lower)

  defp hmac(key, data), do: :crypto.mac(:hmac, :sha256, key, data)
  defp hmac_hex(key, data), do: key |> hmac(data) |> Base.encode16(case: :lower)

  defp signing_key(secret_access_key, date_stamp, region) do
    ("AWS4" <> secret_access_key)
    |> hmac(date_stamp)
    |> hmac(region)
    |> hmac("s3")
    |> hmac("aws4_request")
  end
end
