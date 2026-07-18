defmodule Backend.Telemetry.IceStatsCounterTest do
  # ETS table is process-global shared state (like Backend.RateLimiter's,
  # see invite_controller_rate_limit_test.exs) — not per-test sandboxed,
  # so this runs serialized to avoid one test's counts bleeding into
  # another's.
  use ExUnit.Case, async: false

  alias Backend.Telemetry.IceStatsCounter

  setup do
    # init/1 is safe to call again — :ets.new/2 with a fresh :named_table
    # replaces whatever (if anything) Backend.Telemetry.PeriodicReporter
    # already created at application boot, giving each test a clean slate.
    IceStatsCounter.init()
    :ok
  end

  test "starts at zero" do
    assert IceStatsCounter.read_and_reset() == {0, 0}
  end

  test "counts relay and non-relay connected outcomes separately" do
    IceStatsCounter.record_connected(false)
    IceStatsCounter.record_connected(true)
    IceStatsCounter.record_connected(true)

    assert IceStatsCounter.read_and_reset() == {2, 3}
  end

  test "read_and_reset zeroes both counters back out" do
    IceStatsCounter.record_connected(true)
    assert IceStatsCounter.read_and_reset() == {1, 1}

    assert IceStatsCounter.read_and_reset() == {0, 0}
  end

  test "record_connected/1 doesn't raise when the table doesn't exist" do
    :ets.delete(:backend_ice_stats_counter)

    assert IceStatsCounter.record_connected(true) == :ok
  end
end
