defmodule Backend.WatchParty.Room do
  @moduledoc """
  One voice room's watch-party state (see `Backend.WatchParty`).

  All changes go through this process, so two participants clicking at the
  same moment are simply applied one after the other, and the broadcasts go
  out from here in that same order. Each change bumps `rev`, which clients
  use to drop a reply that arrives after a newer broadcast.

  Participants are the `BackendWeb.WatchChannel` processes that joined;
  they're monitored, and once none are left the room stops after
  `@idle_shutdown_ms` — long enough to survive a reconnect.
  """

  use GenServer, restart: :temporary

  # Upper bound for a client-reported position: a day is far beyond any
  # real video, and keeps a garbage value from producing absurd state.
  @max_position 24 * 60 * 60

  def start_link(room_id) do
    GenServer.start_link(__MODULE__, room_id, name: via(room_id))
  end

  def join(pid, participant), do: GenServer.call(pid, {:join, participant})

  def apply_action(pid, user_id, action), do: GenServer.call(pid, {:action, user_id, action})

  defp via(room_id), do: {:via, Registry, {Backend.WatchParty.Registry, room_id}}

  defp idle_shutdown_ms, do: Application.get_env(:backend, :watch_party_idle_ms, 30_000)

  @impl true
  def init(room_id) do
    {:ok, %{room_id: room_id, participants: %{}, video: nil, rev: 0, shutdown_timer: nil}}
  end

  @impl true
  def handle_call({:join, participant}, _from, state) do
    ref = Process.monitor(participant)

    state =
      cancel_shutdown(%{state | participants: Map.put(state.participants, ref, participant)})

    {:reply, public(state), state}
  end

  def handle_call({:action, user_id, action}, _from, state) do
    case transition(state.video, action, user_id) do
      {:ok, video} ->
        state = %{state | video: video, rev: state.rev + 1}
        payload = public(state)
        BackendWeb.Endpoint.broadcast(Backend.WatchParty.topic(state.room_id), "state", payload)
        {:reply, {:ok, payload}, state}

      {:error, _} = error ->
        {:reply, error, state}
    end
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, _reason}, state) do
    participants = Map.delete(state.participants, ref)
    state = %{state | participants: participants}

    if map_size(participants) == 0 do
      {:noreply,
       %{state | shutdown_timer: Process.send_after(self(), :idle_shutdown, idle_shutdown_ms())}}
    else
      {:noreply, state}
    end
  end

  def handle_info(:idle_shutdown, state) do
    if map_size(state.participants) == 0,
      do: {:stop, :normal, state},
      else: {:noreply, %{state | shutdown_timer: nil}}
  end

  defp cancel_shutdown(%{shutdown_timer: nil} = state), do: state

  defp cancel_shutdown(%{shutdown_timer: timer} = state) do
    Process.cancel_timer(timer)
    %{state | shutdown_timer: nil}
  end

  defp transition(_video, {:load, source}, user_id) do
    {:ok, at(%{source: source, playing: false}, 0, user_id)}
  end

  defp transition(_video, :clear, _user_id), do: {:ok, nil}
  defp transition(nil, _action, _user_id), do: {:error, :no_video}

  defp transition(video, {:play, position}, user_id),
    do: {:ok, at(%{video | playing: true}, position, user_id)}

  defp transition(video, {:pause, position}, user_id),
    do: {:ok, at(%{video | playing: false}, position, user_id)}

  defp transition(video, {:seek, position}, user_id), do: {:ok, at(video, position, user_id)}

  defp at(video, position, user_id) do
    Map.merge(video, %{
      position: position |> max(0) |> min(@max_position) |> Kernel.*(1.0),
      updated_at: System.system_time(:millisecond),
      updated_by: user_id
    })
  end

  defp public(state), do: %{rev: state.rev, video: state.video}
end
