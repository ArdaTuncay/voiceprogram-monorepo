defmodule Backend.Uploads.S3 do
  @moduledoc """
  Uploads a file to an S3-compatible object store (AWS S3, Cloudflare R2,
  DigitalOcean Spaces, ...) via a hand-rolled SigV4-signed PUT request.

  No `ex_aws`/`ex_aws_s3` dependency needed — just `Req` (already a
  dependency, used elsewhere) for the HTTP call and `:crypto` for the
  signature. R2 and Spaces both speak the same SigV4 scheme as S3, so this
  one signer covers all three; only `config :backend, :uploads` differs
  (see config/runtime.exs).
  """

  require Logger

  @doc """
  Uploads `path`'s contents as `key` with the given content type.

  Returns `{:ok, public_url}` or `{:error, reason}`.
  """
  def upload(path, key, content_type) do
    config = Application.fetch_env!(:backend, :uploads)
    body = File.read!(path)

    bucket = Keyword.fetch!(config, :bucket)
    region = Keyword.get(config, :region, "auto")
    access_key_id = Keyword.fetch!(config, :access_key_id)
    secret_access_key = Keyword.fetch!(config, :secret_access_key)

    %{host: host, uri_path: uri_path} = endpoint_parts(config, bucket, key)

    now = DateTime.utc_now()
    amz_date = Calendar.strftime(now, "%Y%m%dT%H%M%SZ")
    date_stamp = Calendar.strftime(now, "%Y%m%d")
    payload_hash = sha256_hex(body)

    headers = %{
      "host" => host,
      "x-amz-content-sha256" => payload_hash,
      "x-amz-date" => amz_date,
      "content-type" => content_type
    }

    {signed_headers, canonical_headers} = canonical_headers(headers)

    canonical_request =
      Enum.join(["PUT", uri_path, "", canonical_headers, "", signed_headers, payload_hash], "\n")

    credential_scope = "#{date_stamp}/#{region}/s3/aws4_request"

    string_to_sign =
      Enum.join(
        ["AWS4-HMAC-SHA256", amz_date, credential_scope, sha256_hex(canonical_request)],
        "\n"
      )

    signature =
      secret_access_key
      |> signing_key(date_stamp, region)
      |> hmac_hex(string_to_sign)

    authorization =
      "AWS4-HMAC-SHA256 Credential=#{access_key_id}/#{credential_scope}, " <>
        "SignedHeaders=#{signed_headers}, Signature=#{signature}"

    url = "https://#{host}#{uri_path}"

    case Req.put(url,
           body: body,
           headers: [
             {"host", host},
             {"x-amz-content-sha256", payload_hash},
             {"x-amz-date", amz_date},
             {"content-type", content_type},
             {"authorization", authorization}
           ]
         ) do
      {:ok, %Req.Response{status: status}} when status in 200..299 ->
        {:ok, public_url(config, bucket, key)}

      {:ok, %Req.Response{status: status, body: resp_body}} ->
        Logger.error("S3 upload failed (#{status}): #{inspect(resp_body)}")
        {:error, :s3_upload_failed}

      {:error, reason} ->
        Logger.error("S3 upload request error: #{inspect(reason)}")
        {:error, reason}
    end
  end

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
