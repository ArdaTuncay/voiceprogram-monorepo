defmodule BackendWeb.RateLimiterPlug do
  @moduledoc """
  General-purpose rate limiter, attach to any controller action with a
  `when action in [...]` guard and a `:scale`/`:limit` pair — the scope
  used to namespace Hammer keys is `{controller, action}`, so different
  actions (even a `:create` in one controller and a `:create` in another)
  never share a bucket. Always hits a per-IP bucket; optionally also hits a
  second bucket keyed by `:key` (default `{:param, "email"}`, for backwards
  compatibility with the original login/register guard), so an attacker
  can't dodge the limit by rotating one dimension while holding the other
  fixed — see `rate_limit_keys/3`.

      # Auth brute-force guard — also keyed by the request's "email" param
      # (path/query/body, via conn.params), so an attacker can't dodge the
      # limit by rotating emails from one IP or rotating IPs against one
      # known email. This is the default `:key`, so it doesn't need
      # spelling out here.
      plug BackendWeb.RateLimiterPlug,
        [scale: :timer.minutes(1), limit: 5] when action in [:login, :register]

      # Anti-enumeration guard keyed by the *authenticated caller*
      # (conn.assigns.current_user), not a request field — every attempt
      # counts against the same bucket no matter which target (username/
      # user_id) it's probing, which a per-target key would miss entirely.
      plug BackendWeb.RateLimiterPlug,
        [scale: :timer.minutes(1), limit: 20, key: :current_user] when action in [:request]

      # Keyed by a path param instead of "email".
      plug BackendWeb.RateLimiterPlug,
        [scale: :timer.minutes(1), limit: 10, key: {:param, "server_id"}]
        when action in [:create]

      # A plain per-IP limit — every action gets one whether or not the
      # request happens to have an "email" param.
      plug BackendWeb.RateLimiterPlug,
        [scale: :timer.minutes(1), limit: 15] when action in [:show]
  """

  import Plug.Conn
  import Phoenix.Controller, only: [action_name: 1, controller_module: 1, json: 2]

  alias Backend.RateLimiter

  @default_scale :timer.minutes(1)
  @default_limit 5
  @default_key {:param, "email"}

  def init(opts), do: opts

  def call(conn, opts) do
    scale = Keyword.get(opts, :scale, @default_scale)
    limit = Keyword.get(opts, :limit, @default_limit)
    key = Keyword.get(opts, :key, @default_key)
    scope = {controller_module(conn), action_name(conn)}

    limited? =
      conn
      |> rate_limit_keys(scope, key)
      |> Enum.map(&RateLimiter.hit(&1, scale, limit))
      |> Enum.any?(&match?({:deny, _retry_after_ms}, &1))

    if limited? do
      conn
      |> put_status(:too_many_requests)
      |> json(%{error: "Too many requests. Please try again later."})
      |> halt()
    else
      conn
    end
  end

  # Always hits the IP key; also hits a `key`-derived key when one can be
  # extracted from the conn (e.g. an "email"/"server_id" param, or the
  # authenticated current_user), so an attacker can't dodge the limit by
  # varying just the IP or just the keyed dimension. Endpoints where the
  # key can't be extracted (GET requests, a param that's absent, no
  # authenticated user) just get the plain per-IP limit.
  defp rate_limit_keys(conn, scope, key) do
    ip_key = {scope, :ip, ip_string(conn.remote_ip)}

    case extra_key_value(conn, key) do
      {:ok, value} -> [ip_key, {scope, key, value}]
      :error -> [ip_key]
    end
  end

  defp extra_key_value(conn, {:param, field}) do
    case conn.params[field] do
      value when is_binary(value) and value != "" -> {:ok, String.downcase(value)}
      _ -> :error
    end
  end

  defp extra_key_value(conn, :current_user) do
    case conn.assigns[:current_user] do
      %{id: id} -> {:ok, id}
      _ -> :error
    end
  end

  defp ip_string(remote_ip), do: remote_ip |> :inet.ntoa() |> to_string()
end
