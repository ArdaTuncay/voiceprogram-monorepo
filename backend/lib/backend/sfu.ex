defmodule Backend.Sfu do
  @moduledoc """
  Voice through Cloudflare Realtime SFU instead of a peer-to-peer mesh.

  In a mesh every participant sends their audio to every other one, so
  upload grows with the room — fine for a few people, not for a crowded
  room. Through the SFU each participant sends once to Cloudflare and
  receives everyone else from there.

  The browser talks WebRTC to Cloudflare directly; only the API calls that
  set it up go through here (via `BackendWeb.VoiceChannel`), because they
  carry the app secret. Each participant has one SFU session, publishes
  named tracks into it ("audio", "screen") and pulls the tracks of the
  others in the room.

  Configured with `CLOUDFLARE_SFU_APP_ID` and `CLOUDFLARE_SFU_APP_SECRET`;
  without them voice stays peer-to-peer.
  """

  @base_url "https://rtc.live.cloudflare.com/v1"

  @doc "Whether an SFU app is configured."
  def enabled?, do: is_binary(config(:app_id)) and is_binary(config(:app_secret))

  @doc "A new, empty session: `{:ok, session_id}`."
  def new_session do
    case request(:post, "/sessions/new", nil) do
      {:ok, %{"sessionId" => id}} when is_binary(id) -> {:ok, id}
      {:ok, _body} -> {:error, :unexpected_response}
      error -> error
    end
  end

  @doc "POST tracks/new — publish local tracks or pull remote ones (`body` as the API takes it)."
  def tracks_new(session_id, body), do: request(:post, "/sessions/#{session_id}/tracks/new", body)

  @doc "PUT renegotiate — the browser's answer to an SFU offer."
  def renegotiate(session_id, body),
    do: request(:put, "/sessions/#{session_id}/renegotiate", body)

  @doc "PUT tracks/close."
  def close_tracks(session_id, body),
    do: request(:put, "/sessions/#{session_id}/tracks/close", body)

  defp request(method, path, body) do
    options =
      [
        method: method,
        url: "#{@base_url}/apps/#{config(:app_id)}#{path}",
        auth: {:bearer, config(:app_secret)},
        retry: false,
        receive_timeout: 10_000
      ]
      |> then(fn opts -> if body, do: Keyword.put(opts, :json, body), else: opts end)
      |> Keyword.merge(config(:req_options) || [])

    case Req.request(options) do
      {:ok, %Req.Response{status: status, body: response}} when status in 200..299 ->
        {:ok, response}

      {:ok, %Req.Response{status: status}} ->
        {:error, {:status, status}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp config(key), do: Application.get_env(:backend, __MODULE__, [])[key]
end
