defmodule Backend.RateLimiter do
  @moduledoc """
  Hammer-backed rate limiter, ETS backend (single-node — fine for the
  current one-instance deployment, see DEPLOYMENT.md). Used by
  `BackendWeb.RateLimiterPlug` to guard the login/register endpoints
  against brute-force attempts; see that module for the actual policy
  (limit, scale, and which keys get hit).
  """
  use Hammer, backend: :ets
end
