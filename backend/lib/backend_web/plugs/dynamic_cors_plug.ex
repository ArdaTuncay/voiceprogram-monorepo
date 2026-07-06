defmodule BackendWeb.DynamicCORSPlug do
  @moduledoc """
  Wraps CORSPlug so the allowed origin is read from `Application.get_env/3`
  fresh on every request (inside `call/2`, not at module/compile time) —
  needed because :cors_origins is only set once `config/runtime.exs` runs
  at release boot, after the FRONTEND_URL env var is available.
  """
  @behaviour Plug

  @impl true
  def init(_opts), do: []

  @impl true
  def call(conn, opts) do
    origin = Application.get_env(:backend, :cors_origins, "*")
    CORSPlug.call(conn, CORSPlug.init(Keyword.put(opts, :origin, origin)))
  end
end
