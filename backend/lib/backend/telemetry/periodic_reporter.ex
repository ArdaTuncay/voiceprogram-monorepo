defmodule Backend.Telemetry.PeriodicReporter do
  @moduledoc """
  Logs one structured summary line every `interval` (default 5 minutes —
  see `config :backend, Backend.Telemetry.PeriodicReporter, interval:
  ...`) with `event: "periodic_metrics"` in its metadata:

    * `active_voice_channels` / `connected_voice_users` — aggregated from
      `Backend.Chat.list_voice_channel_ids/0` + `Backend.Presence.list/1`
      per id (see that function's doc for why two data sources, not one
      — Presence alone can't enumerate its own active topics).
    * `ice_relay_count` / `ice_connected_total` — from
      `Backend.Telemetry.IceStatsCounter`, reset every tick, so this is
      "in the last `interval`", not a running total since boot.
    * `uptime_seconds` — this process's own age, a reasonable proxy for
      "how long has this instance been serving" without reaching into
      `:init.get_status/0` or similar.

  In prod, `config/runtime.exs` switches the default Logger handler to
  `LoggerJSON.Formatters.Basic` — these fields land in the JSON log line
  as their own top-level keys, greppable/filterable in a Render/Railway
  log viewer (e.g. `event:"periodic_metrics"`) — see
  PROJECT_ARCHITECTURE.md 2.8.

  Started under `Backend.Application`'s supervision tree (see
  application.ex) — restarts (and its `IceStatsCounter` ETS table along
  with it) on crash like anything else there.
  """

  use GenServer

  require Logger

  alias Backend.Chat
  alias Backend.Presence
  alias Backend.Telemetry.IceStatsCounter

  @default_interval :timer.minutes(5)

  def start_link(opts \\ []) do
    {name, opts} = Keyword.pop(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @impl true
  def init(opts) do
    IceStatsCounter.init()
    interval = Keyword.get(opts, :interval, configured_interval())
    schedule_report(interval)
    {:ok, %{interval: interval, started_at: System.monotonic_time(:second)}}
  end

  @impl true
  def handle_info(:report, state) do
    report(state)
    schedule_report(state.interval)
    {:noreply, state}
  end

  @doc """
  Active voice channel count and total connected-user count across all of
  them, right now — `{active_voice_channels, connected_voice_users}`. A
  channel only counts as "active" if at least one user is actually
  present in it. Exposed as a public function (not folded into `report/1`
  as a private one) specifically so a test can assert on the aggregation
  itself without waiting on — or mocking — this GenServer's own timer.
  """
  def voice_presence_summary do
    active_rooms =
      Chat.list_voice_channel_ids()
      |> Enum.map(&Presence.list("voice:#{&1}"))
      |> Enum.reject(&(map_size(&1) == 0))

    {length(active_rooms), active_rooms |> Enum.map(&map_size/1) |> Enum.sum()}
  end

  defp schedule_report(interval), do: Process.send_after(self(), :report, interval)

  defp configured_interval do
    :backend
    |> Application.get_env(__MODULE__, [])
    |> Keyword.get(:interval, @default_interval)
  end

  defp report(state) do
    {active_voice_channels, connected_voice_users} = voice_presence_summary()
    {ice_relay_count, ice_connected_total} = IceStatsCounter.read_and_reset()
    uptime_seconds = System.monotonic_time(:second) - state.started_at

    Logger.info("periodic metrics summary",
      event: "periodic_metrics",
      active_voice_channels: active_voice_channels,
      connected_voice_users: connected_voice_users,
      ice_relay_count: ice_relay_count,
      ice_connected_total: ice_connected_total,
      uptime_seconds: uptime_seconds
    )
  end
end
