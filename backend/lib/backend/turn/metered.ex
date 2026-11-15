defmodule Backend.Turn.Metered do
  @moduledoc """
  The two Metered TURN Server REST calls `Backend.Turn` needs to issue a
  per-user, expiring credential (docs: metered.ca/docs/turn-rest-api):

    1. `POST https://<app>.metered.live/api/v1/turn/credential?secretKey=…`
       with `expiryInSeconds`/`label` — creates the credential and returns
       its `username`, `password` and a credential-scoped `apiKey`.
    2. `GET https://<app>.metered.live/api/v1/turn/credentials?apiKey=…` —
       that credential's ready-made `iceServers` list (URLs, username,
       credential), so the relay URLs aren't hardcoded here.

  The account-wide secret key only ever travels to Metered, as the query
  parameter their API requires; it is never logged (errors are reported by
  status/reason only, never with the request URL) and never sent to
  clients. Configured via `config :backend, :metered_api, %{app_name:,
  secret_key:}` (`METERED_APP_NAME`/`METERED_SECRET_KEY` in prod).
  """

  @timeout_ms 5_000

  @type issued :: %{username: String.t(), ice_servers: [map()], expires_in: pos_integer()}

  @doc "True when both the app name and secret key are configured."
  @spec configured?() :: boolean()
  def configured? do
    match?({:ok, _app, _key}, config())
  end

  @doc """
  Creates a credential that expires after `expiry_seconds`, labelled with
  `label` (an opaque user id — Metered's per-label usage then shows which
  account a relay's traffic belongs to), and returns its ICE server list.
  """
  @spec create_credential(String.t(), pos_integer()) :: {:ok, issued()} | {:error, term()}
  def create_credential(label, expiry_seconds) do
    with {:ok, app, secret_key} <- config(),
         {:ok, %{"username" => username, "apiKey" => api_key}} <-
           request(:post, app, "/api/v1/turn/credential",
             params: [secretKey: secret_key],
             json: %{expiryInSeconds: expiry_seconds, label: label}
           ),
         {:ok, servers} <-
           request(:get, app, "/api/v1/turn/credentials", params: [apiKey: api_key]),
         {:ok, ice_servers} <- normalize_ice_servers(servers) do
      {:ok, %{username: username, ice_servers: ice_servers, expires_in: expiry_seconds}}
    else
      {:ok, unexpected} -> {:error, {:unexpected_response, shape(unexpected)}}
      {:error, _reason} = error -> error
    end
  end

  defp config do
    case Application.get_env(:backend, :metered_api) do
      %{app_name: app, secret_key: key}
      when is_binary(app) and app != "" and is_binary(key) and key != "" ->
        {:ok, app, key}

      _ ->
        {:error, :not_configured}
    end
  end

  defp request(method, app, path, opts) do
    # Test-only seam: config/test.exs routes these through Req.Test.
    extra = Keyword.get(Application.get_env(:backend, __MODULE__, []), :req_options, [])

    options =
      [
        method: method,
        url: "https://#{app}.metered.live#{path}",
        receive_timeout: @timeout_ms,
        retry: false
      ] ++ opts ++ extra

    case Req.request(options) do
      {:ok, %Req.Response{status: 200, body: body}} -> {:ok, body}
      {:ok, %Req.Response{status: status}} -> {:error, {:http_status, status}}
      {:error, exception} -> {:error, {:transport, Exception.message(exception)}}
    end
  end

  # Keeps only what an RTCIceServer needs, and refuses anything that isn't
  # a non-empty list of entries with `urls` — that's what clients get.
  defp normalize_ice_servers([_ | _] = servers) do
    entries =
      Enum.flat_map(servers, fn
        %{"urls" => urls} = entry when is_binary(urls) or is_list(urls) ->
          [Map.take(entry, ["urls", "username", "credential"])]

        _ ->
          []
      end)

    if entries == [], do: {:error, :no_ice_servers}, else: {:ok, entries}
  end

  defp normalize_ice_servers(_other), do: {:error, :no_ice_servers}

  # For error logs: what kind of thing came back, never its contents
  # (a credential response contains a password).
  defp shape(value) when is_map(value), do: {:map_keys, value |> Map.keys() |> Enum.sort()}
  defp shape(value) when is_list(value), do: :list
  defp shape(value) when is_binary(value), do: :binary
  defp shape(_value), do: :other
end
