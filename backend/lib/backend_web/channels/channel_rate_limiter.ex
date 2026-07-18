defmodule BackendWeb.ChannelRateLimiter do
  @moduledoc """
  Shared `Backend.RateLimiter` (Hammer/ETS) wrapper for Phoenix Channel
  `handle_in/3` callbacks. `BackendWeb.RateLimiterPlug` can't be reused here —
  it's a `Plug.Conn` pipeline plug, and channel processes never enter that
  pipeline once the socket is upgraded. Callers key their bucket on
  `socket.assigns.user_id` (never IP — the socket is already authenticated,
  and NAT means unrelated users can legitimately share an IP), scoped by
  event type and room/channel/peer so a user's flood in one room can't burn
  their budget in another.
  """

  require Logger

  alias Backend.RateLimiter

  @doc """
  Hits the bucket for `key` and returns `true` if it's over `limit` per
  `scale` milliseconds. Logs (without message content) on the first request
  that trips the limit and every one after, so abuse patterns are visible in
  the logs without needing a dedicated metric.
  """
  @spec limited?(term(), pos_integer(), pos_integer(), String.t(), String.t()) :: boolean()
  def limited?(key, scale, limit, user_id, event) do
    case RateLimiter.hit(key, scale, limit) do
      {:allow, _count} ->
        false

      {:deny, _retry_after_ms} ->
        Logger.warning("channel rate limit exceeded user_id=#{user_id} event=#{event}")
        true
    end
  end
end
