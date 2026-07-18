defmodule Backend.Telemetry.IceStatsCounter do
  @moduledoc """
  A minimal ETS-backed counter for how many `"connected"` voice ICE
  outcomes needed a TURN relay vs. how many didn't (see
  `BackendWeb.VoiceChannel`'s `"report_ice_stats"` handler, which
  increments this) — read and reset once per
  `Backend.Telemetry.PeriodicReporter` tick, so each periodic summary
  covers only its own interval, not a running total since boot.

  Plain ETS chosen over `:counters` or an `Agent`: this project already
  uses ETS for exactly this kind of lightweight shared counter (see
  `Backend.RateLimiter`) — no fixed-size index range to pre-allocate and
  reason about (unlike `:counters`), and no extra GenServer/message-
  passing serialization for what's at most a couple of increments a
  minute (unlike an `Agent`, whose single-process mailbox would be
  unnecessary overhead here — ETS's own atomic `update_counter/4` already
  handles concurrent writers from multiple voice channel processes
  safely without one).

  Owned by (created in `init/1` of) `Backend.Telemetry.PeriodicReporter`
  — dies and comes back empty if that GenServer crashes and restarts,
  same as the counters it's reading would anyway. `record_connected/1`
  no-ops (rather than raising) if the table doesn't exist yet, so a
  voice channel process can't crash because this hasn't started yet or
  isn't running in a given test.
  """

  @table :backend_ice_stats_counter

  @doc """
  Creates the ETS table, or — if it already exists (a GenServer restart,
  or a test's own `setup` calling this again while the app-supervised
  instance from `Backend.Application` is still alive for the whole test
  run) — clears it back to a known-empty state instead of trying to
  recreate it (`:ets.new/2` raises `ArgumentError` on a name collision).
  """
  def init do
    if :ets.whereis(@table) == :undefined do
      :ets.new(@table, [:named_table, :public, :set, {:write_concurrency, true}])
    else
      :ets.delete_all_objects(@table)
      @table
    end
  end

  @doc "Records one 'connected' outcome — relay?: true if it selected a TURN relay candidate."
  def record_connected(relay?) do
    if :ets.whereis(@table) != :undefined do
      :ets.update_counter(@table, :total, {2, 1}, {:total, 0})
      if relay?, do: :ets.update_counter(@table, :relay, {2, 1}, {:relay, 0})
    end

    :ok
  end

  @doc """
  Returns `{relay_count, total_count}` for the interval since the last
  reset, then zeroes both back out.

  Not perfectly atomic across the read-then-reset (a `record_connected/1`
  landing in between would be silently dropped) — acceptable for a
  diagnostic counter meant to be grepped from logs over a few weeks to
  inform one infrastructure decision, not a metric anything is billed or
  alerted on.
  """
  def read_and_reset do
    relay = get(:relay)
    total = get(:total)
    :ets.insert(@table, [{:relay, 0}, {:total, 0}])
    {relay, total}
  end

  defp get(key) do
    case :ets.lookup(@table, key) do
      [{^key, value}] -> value
      [] -> 0
    end
  end
end
