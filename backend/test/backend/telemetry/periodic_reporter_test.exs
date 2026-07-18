defmodule Backend.Telemetry.PeriodicReporterTest do
  # Starts its own short-lived, unregistered PeriodicReporter instances
  # (never the app-supervised singleton — see the tests below) and
  # directly manipulates Backend.Telemetry.IceStatsCounter's process-
  # global ETS table — same "not sandboxed, run serialized" reasoning as
  # ice_stats_counter_test.exs.
  use Backend.DataCase, async: false

  import ExUnit.CaptureLog

  alias Backend.Servers
  alias Backend.Telemetry.{IceStatsCounter, PeriodicReporter}

  setup do
    IceStatsCounter.init()
    :ok
  end

  describe "voice_presence_summary/0" do
    test "counts only voice channels with someone present, and sums their users" do
      owner = user_fixture()
      server = server_fixture(owner)

      {:ok, active_room} =
        Servers.create_channel(server.id, %{"name" => "active-voice", "type" => "voice"})

      {:ok, _empty_room} =
        Servers.create_channel(server.id, %{"name" => "empty-voice", "type" => "voice"})

      other = user_fixture()
      fake_pid = spawn(fn -> Process.sleep(:infinity) end)

      {:ok, _} = Backend.Presence.track(fake_pid, "voice:#{active_room.id}", owner.id, %{})
      {:ok, _} = Backend.Presence.track(fake_pid, "voice:#{active_room.id}", other.id, %{})

      assert PeriodicReporter.voice_presence_summary() == {1, 2}
    end

    test "counts zero active channels/users when no one is in any voice channel" do
      owner = user_fixture()
      server = server_fixture(owner)

      {:ok, _room} =
        Servers.create_channel(server.id, %{"name" => "empty-voice", "type" => "voice"})

      assert PeriodicReporter.voice_presence_summary() == {0, 0}
    end
  end

  describe "periodic reporting" do
    test "reports on its own recurring schedule, not just once at startup" do
      # config/test.exs sets the global Logger level to :warning, so an
      # :info-level call is dropped before it ever reaches a handler —
      # capture_log's own :level option does NOT override that (see its
      # docs: "this setting does not override the overall Logger.level/0
      # value"). Logger.put_module_level/2 is the actual, documented way
      # to let one module's logs through regardless of the global floor.
      Logger.put_module_level(PeriodicReporter, :info)
      on_exit(fn -> Logger.delete_module_level(PeriodicReporter) end)

      log =
        capture_log(fn ->
          # GenServer.start_link/2 directly (not PeriodicReporter.start_link/1)
          # — deliberately unregistered, so this doesn't collide with the
          # single app-supervised instance already running under the
          # module name for the whole test suite's lifetime (see
          # application.ex).
          {:ok, pid} = GenServer.start_link(PeriodicReporter, interval: 10)
          Process.sleep(200)
          GenServer.stop(pid)
        end)

      occurrences =
        log
        |> String.split("periodic metrics summary")
        |> length()
        |> Kernel.-(1)

      # 200ms / 10ms-interval allows ~20 fires in theory — a generous
      # lower bound of 3 (not an exact count) since this is real
      # wall-clock timing under whatever load the rest of the suite is
      # putting on the machine at the same time (each tick's own DB
      # query in voice_presence_summary/0 adds real, variable latency
      # too), not a virtual/fake clock. The point is proving it recurs on
      # its own more than once, not proving an exact tick count — a
      # tighter margin here flaked under concurrent test-suite load.
      assert occurrences >= 3
    end

    test "resets the IceStatsCounter after each report" do
      IceStatsCounter.record_connected(true)

      capture_log([level: :info], fn ->
        {:ok, pid} = GenServer.start_link(PeriodicReporter, interval: 15)
        Process.sleep(30)
        GenServer.stop(pid)
      end)

      assert IceStatsCounter.read_and_reset() == {0, 0}
    end
  end
end
