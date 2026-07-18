defmodule Backend.Turn do
  @moduledoc """
  Builds the ICE server list for Metered.ca's TURN Server product from a
  single static username/credential pair (`config :backend, :turn_config,
  %{username: ..., credential: ...}` — `config/dev.secret.exs` locally,
  `METERED_TURN_USERNAME`/`METERED_TURN_CREDENTIAL` in prod, see
  `config/runtime.exs`) — used by `BackendWeb.VoiceController` so the
  credential pair never reaches the frontend as a `VITE_*` var.

  Originally this module made a live HTTP call to
  `https://<app>.metered.live/api/v1/turn/credentials` on every request
  (Metered's *managed video/voice* product's dynamic-credential REST API,
  see its docs at metered.ca/docs/turn-rest-api/get-credential/) — that
  turned out to be the wrong product for this project's actual Metered
  plan. The **TURN Server** product (what's actually configured here,
  dashboard "zircle" project) hands out ONE static, long-lived username/
  credential pair instead — there's no per-request "fetch fresh
  credentials" call for it at all. So this makes **no network request**:
  it's a plain config-driven list builder, safe to call on every request
  with no external latency/failure mode beyond "is config set". URLs
  below are Metered's own documented TURN Server endpoints for that
  project, not guessed.
  """

  require Logger

  @stun_url "stun:stun.relay.metered.ca:80"
  @turn_urls [
    "turn:global.relay.metered.ca:80",
    "turn:global.relay.metered.ca:80?transport=tcp",
    "turn:global.relay.metered.ca:443",
    "turns:global.relay.metered.ca:443?transport=tcp"
  ]

  @doc """
  Returns `{:ok, ice_servers}` — always. Metered's STUN entry plus all 4
  TURN entries (username/credential filled in) when `:turn_config` is
  set to a `%{username:, credential:}` map with non-empty string values;
  otherwise just the bare STUN entry (no username/credential needed for
  STUN) and a warning log. A missing config is expected in dev without
  `dev.secret.exs` — not an error.
  """
  def fetch_ice_servers do
    case Application.get_env(:backend, :turn_config) do
      %{username: username, credential: credential}
      when is_binary(username) and username != "" and is_binary(credential) and credential != "" ->
        {:ok, ice_servers(username, credential)}

      _ ->
        Logger.warning(
          "Metered TURN yapılandırılmamış (:turn_config set değil), sadece STUN kullanılacak"
        )

        {:ok, [%{urls: @stun_url}]}
    end
  end

  defp ice_servers(username, credential) do
    turn_entries =
      Enum.map(@turn_urls, fn url -> %{urls: url, username: username, credential: credential} end)

    [%{urls: @stun_url} | turn_entries]
  end
end
