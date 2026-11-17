defmodule BackendWeb.WatchChannel do
  @moduledoc """
  "Birlikte izle" for a voice room: `"watch:<room_id>"`, where `room_id` is
  the voice channel's id. See `Backend.WatchParty` for the model.

  Only someone currently in that voice room (tracked in its
  `BackendWeb.VoiceChannel` presence) can join — watching together is part
  of being in the call, so the client joins this right after the voice
  room and leaves it with the voice room.

  Events in: `"load"` (`url`), `"play"`/`"pause"`/`"seek"` (`position` in
  seconds), `"clear"`, and `"ping"`, which replies with the server clock so
  the client can line its clock up with `updated_at`. Every change is
  broadcast to the topic as `"state"` (`%{rev, video}`) by the room process.
  """

  use Phoenix.Channel

  alias Backend.Chat
  alias Backend.Presence
  alias Backend.Servers
  alias Backend.WatchParty
  alias BackendWeb.ChannelRateLimiter

  # play/pause/seek: a person clicking and scrubbing — generous, only a
  # backstop against a looping client.
  @control_scale :timer.minutes(1)
  @control_limit 120

  @load_scale :timer.minutes(1)
  @load_limit 15

  @ping_scale :timer.minutes(1)
  @ping_limit 30

  @impl true
  def join("watch:" <> room_id, _params, socket) do
    user_id = socket.assigns.user_id

    with %{type: "voice"} = channel <- Chat.get_channel(room_id),
         :ok <- Servers.subscribe_to_membership(channel.server_id, user_id),
         {:member, true} <- {:member, Servers.member?(channel.server_id, user_id)},
         {:in_voice, true} <- {:in_voice, in_voice_room?(room_id, user_id)} do
      state = WatchParty.join(room_id, self())
      {:ok, %{state: state, server_time: now()}, assign(socket, :room_id, room_id)}
    else
      {:member, false} -> {:error, %{reason: "not authorized"}}
      {:in_voice, false} -> {:error, %{reason: "not_in_voice"}}
      # nil (no such channel) or a text/category channel.
      _ -> {:error, %{reason: "channel not found"}}
    end
  end

  defp in_voice_room?(room_id, user_id) do
    Map.has_key?(Presence.list("voice:#{room_id}"), user_id)
  end

  # Kicked from the server: same as BackendWeb.VoiceChannel.
  @impl true
  def handle_info({:server_membership_revoked, server_id}, socket) do
    push(socket, "access_revoked", %{server_id: server_id})
    {:stop, {:shutdown, :membership_revoked}, socket}
  end

  @impl true
  def handle_in("ping", _payload, socket) do
    if limited?(socket, "ping", @ping_scale, @ping_limit),
      do: {:reply, {:error, %{reason: "rate_limited"}}, socket},
      else: {:reply, {:ok, %{server_time: now()}}, socket}
  end

  def handle_in("load", %{"url" => url}, socket) do
    with false <- limited?(socket, "load", @load_scale, @load_limit),
         {:ok, source} <- WatchParty.parse_source(url) do
      act(socket, {:load, source})
    else
      true -> {:reply, {:error, %{reason: "rate_limited"}}, socket}
      {:error, :invalid_url} -> {:reply, {:error, %{reason: "invalid_url"}}, socket}
    end
  end

  def handle_in("clear", _payload, socket), do: control(socket, :clear)

  def handle_in(event, %{"position" => position}, socket)
      when event in ["play", "pause", "seek"] and is_number(position) do
    control(socket, {String.to_existing_atom(event), position})
  end

  def handle_in(_event, _payload, socket) do
    {:reply, {:error, %{reason: "invalid_payload"}}, socket}
  end

  defp control(socket, action) do
    if limited?(socket, "control", @control_scale, @control_limit),
      do: {:reply, {:error, %{reason: "rate_limited"}}, socket},
      else: act(socket, action)
  end

  defp act(socket, action) do
    case WatchParty.apply_action(socket.assigns.room_id, socket.assigns.user_id, action) do
      {:ok, state} -> {:reply, {:ok, state}, socket}
      {:error, reason} -> {:reply, {:error, %{reason: Atom.to_string(reason)}}, socket}
    end
  end

  defp limited?(socket, event, scale, limit) do
    user_id = socket.assigns.user_id
    key = {:watch, event, user_id, socket.assigns.room_id}
    ChannelRateLimiter.limited?(key, scale, limit, user_id, "watch_" <> event)
  end

  defp now, do: System.system_time(:millisecond)
end
