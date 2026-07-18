defmodule BackendWeb.VoiceController do
  use BackendWeb, :controller

  alias Backend.Turn

  # Backend.Turn does no I/O (a static, config-driven list — see its own
  # moduledoc), so this rate limit isn't guarding against real load/cost;
  # it's just a low backstop against a client re-requesting needlessly,
  # keyed by the caller not just per-IP (see BackendWeb.RateLimiterPlug's
  # own moduledoc example for this exact pattern) so a shared-IP user
  # (NAT, office network) can't exhaust another user's budget.
  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 10, key: :current_user]
       when action in [:turn_credentials]

  @doc """
  GET /api/voice/turn-credentials — returns Metered.ca TURN Server
  credentials built from server-side config (see `Backend.Turn`) so the
  static username/credential pair never reaches the frontend as a
  `VITE_*` var. Always 200s with an `ice_servers` array — just a bare
  STUN entry (not an error status) when no TURN config is set, since the
  frontend adds whatever comes back to its own static STUN list rather
  than depending on it (see `useVoiceChannel.ts`).
  """
  def turn_credentials(conn, _params) do
    {:ok, ice_servers} = Turn.fetch_ice_servers()
    json(conn, %{ice_servers: ice_servers})
  end
end
