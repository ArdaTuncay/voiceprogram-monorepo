defmodule Backend.RateLimiter do
  @moduledoc """
  Hammer-backed rate limiter, ETS backend (single-node — fine for the
  current one-instance deployment, see DEPLOYMENT.md). Used by
  `BackendWeb.RateLimiterPlug` and `BackendWeb.ChannelRateLimiter`; see
  those modules for the actual policies (limit, scale, and which keys get
  hit).

  Algorithm: `:fix_window_per_key` — each key's window starts at its own
  first hit, instead of Hammer's default `:fix_window`, whose windows are
  aligned to wall-clock boundaries shared by every key. With aligned
  windows, a burst that happened to straddle a boundary was split across
  two counters; that made rate-limit tests fail at random (21 requests
  sent across a minute boundary were never limited) and let anyone time
  bursts against a predictable reset. Counting stays atomic
  (`:ets.update_counter/4`).

  Not `:sliding_window`: in Hammer 7.4 it stores one row per hit keyed by
  the microsecond timestamp with `:ets.insert_new/2`, so two hits landing
  in the same microsecond count once — under a parallel burst (exactly
  what a brute-force attempt looks like) hits slip through uncounted. A
  per-key fixed window still allows up to 2x the limit across one key's
  own window rollover, which is acceptable for these limits.
  """
  use Hammer, backend: :ets, algorithm: :fix_window_per_key
end
