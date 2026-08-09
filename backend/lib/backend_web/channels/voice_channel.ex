defmodule BackendWeb.VoiceChannel do
  @moduledoc """
  WebRTC signaling relay for a voice channel's room — joins/leaves drive
  presence (used to seed new peers with who to call), and offers/answers/ICE
  candidates are relayed as opaque payloads between peers (see
  `useVoiceChannel.ts`, which does the actual peer connection work).
  """

  use Phoenix.Channel

  require Logger

  alias Backend.Chat
  alias Backend.Presence
  alias Backend.Servers
  alias Backend.Telemetry.IceStatsCounter
  alias BackendWeb.ChannelRateLimiter

  # "update_status" (mute/deafen): infrequent, deliberate user action —
  # generous headroom, just a backstop against a buggy client looping.
  @update_status_scale :timer.minutes(1)
  @update_status_limit 30

  # "report_ice_stats": diagnostic-only, fires at most once per peer
  # connection per outcome (see useVoiceChannel.ts's logIceOutcome) — a
  # generous budget here is just a backstop against a malicious/buggy
  # client spamming fake diagnostic log lines, not a meaningful abuse
  # vector on its own (see handle_in/3 below for what actually gets
  # logged, and why it's safe to).
  @ice_stats_scale :timer.minutes(1)
  @ice_stats_limit 20
  @valid_candidate_types ~w(host srflx prflx relay)
  @valid_connection_states ~w(connected failed)

  # "video_offer"/"video_answer"/"ice_candidate": share ONE bucket per
  # ordered peer pair (not one bucket per event type) because they're all
  # part of negotiating a single connection — a normal negotiation is one
  # offer/answer plus a handful of ICE candidates, so a shared per-pair
  # budget catches a flood aimed at one peer without needing to guess how
  # that flood is split across the three message types. Keyed off
  # `socket.topic` (not a dedicated assign — voice_channel doesn't store a
  # room id in assigns) so a flood in one room can't burn a user's budget
  # signaling in another.
  @signal_scale :timer.seconds(10)
  @signal_limit 50

  @impl true
  def join("voice:" <> room_id, _params, socket) do
    with channel when not is_nil(channel) <- Chat.get_channel(room_id),
         true <- Servers.member?(channel.server_id, socket.assigns.user_id) do
      # Peers already tracked in this room before we track ourselves below —
      # the joining client uses this list to initiate WebRTC offers, so each
      # pair only negotiates once (no offer/offer glare).
      existing_peers = socket |> Presence.list() |> Map.keys()

      if socket.assigns.user_id in existing_peers do
        # Same user already has a live channel process in this room
        # (another tab/device). Reject rather than evict the existing
        # connection — force-dropping it could silently cut an active call
        # on another device the user isn't looking at right now, which is a
        # riskier UX call than just refusing the new join.
        {:error, %{reason: "already_connected_elsewhere"}}
      else
        # Tracked here (synchronously), not in the :after_join handler below
        # — `existing_peers` was just read from the same Presence state
        # we're about to write to, so track needs to happen as close to that
        # read as possible to keep the TOCTOU gap between the duplicate-join
        # check and this join actually registering itself as tight as the
        # channel model allows. `socket.channel_pid` is already set to
        # `self()` by Phoenix before `join/3` runs, so this is safe to call
        # here rather than deferring it.
        {:ok, _} =
          Presence.track(socket, socket.assigns.user_id, %{
            username: socket.assigns.username,
            online_at: System.system_time(:second),
            muted: false,
            deafened: false
          })

        send(self(), :after_join)

        # Lets anyone viewing this room's server (not just people who've
        # already joined this specific voice room's own topic) see who's in
        # it, without joining "voice:<id>" themselves first — see
        # Chat.voice_occupants/1's own doc for why this needs a plain
        # `Presence.list/1` read rather than reusing `existing_peers` above
        # (that's the pre-track list; this needs to include the peer who
        # just joined).
        broadcast_voice_presence(channel.server_id, room_id)

        {:ok, %{peers: existing_peers}, socket}
      end
    else
      nil -> {:error, %{reason: "channel not found"}}
      false -> {:error, %{reason: "not authorized"}}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  # Fires on every kind of departure — an explicit `leave()`, the socket
  # closing (tab closed, network drop, browser crash), or the channel
  # process crashing — so "who's in this voice room" broadcasts to
  # "server:<id>" stay accurate even when the client never got a chance to
  # signal anything on its way out. `channel`/`room_id` are looked up again
  # (join/3 doesn't stash them in socket.assigns) rather than trusting
  # anything that might have changed since join — the channel could have
  # been deleted out from under an active call.
  @impl true
  def terminate(_reason, socket) do
    "voice:" <> room_id = socket.topic

    # Phoenix.Presence untracks this process automatically once it exits,
    # but that happens asynchronously in the separate Tracker process (it
    # monitors us and reacts to our :DOWN, rather than untracking inline as
    # part of *our* termination) — reading voice_occupants/1 right now,
    # before this call, could still include ourselves. Untracking
    # explicitly and synchronously first guarantees the broadcast below
    # reflects the list *after* this departure, not a split second before.
    Presence.untrack(socket, socket.assigns.user_id)

    case Chat.get_channel(room_id) do
      nil -> :ok
      channel -> broadcast_voice_presence(channel.server_id, room_id)
    end
  end

  defp broadcast_voice_presence(server_id, room_id) do
    BackendWeb.Endpoint.broadcast("server:#{server_id}", "voice_presence_updated", %{
      channel_id: room_id,
      users: Chat.voice_occupants(room_id)
    })
  end

  # Mute/deafen are purely presence metadata — updating it broadcasts a
  # "presence_diff" that every peer's Presence client already listens to
  # (same mechanism that drives the existing participant list), so no
  # separate custom event is needed.
  @impl true
  def handle_in("update_status", %{"muted" => muted, "deafened" => deafened}, socket) do
    key = {:voice, "update_status", socket.topic, socket.assigns.user_id}

    unless ChannelRateLimiter.limited?(
             key,
             @update_status_scale,
             @update_status_limit,
             socket.assigns.user_id,
             "voice_update_status"
           ) do
      {:ok, _} =
        Presence.update(socket, socket.assigns.user_id, fn meta ->
          Map.merge(meta, %{muted: muted, deafened: deafened})
        end)
    end

    {:noreply, socket}
  end

  # Explicit "I just stopped screen sharing" signal — independent of the
  # WebRTC renegotiation useVoiceChannel.ts's stopScreenShare also does
  # alongside this (removeTrack + a fresh offer). That renegotiation alone
  # isn't relied on to tell every peer: whether a remote track's 'ended'
  # event actually fires when a transceiver is renegotiated down to
  # recvonly/inactive is a real-browser-timing detail this channel can't
  # see from here, so this gives clients a second, unambiguous way to know
  # to clear that peer's tile. Same shape as ChatChannel's "typing": no
  # persistence, just a relay.
  @impl true
  def handle_in("screen_share_stopped", _payload, socket) do
    broadcast_from!(socket, "screen_share_stopped", %{user_id: socket.assigns.user_id})
    {:noreply, socket}
  end

  # SDP offers, SDP answers and ICE candidates are opaque to the server —
  # it only relays them to every other peer in the room. Each payload
  # carries "to"/"from" user ids so the intended recipient can pick it out;
  # "from" is overwritten with the authenticated id so a client can't spoof
  # signaling messages as if they came from someone else.
  @impl true
  def handle_in("video_offer", payload, socket), do: relay_signal(socket, "video_offer", payload)

  @impl true
  def handle_in("video_answer", payload, socket),
    do: relay_signal(socket, "video_answer", payload)

  @impl true
  def handle_in("ice_candidate", payload, socket),
    do: relay_signal(socket, "ice_candidate", payload)

  # Diagnostic-only — see useVoiceChannel.ts's logIceOutcome, which sends
  # this once per peer connection when it reaches "connected" or "failed",
  # after inspecting its own getStats() to find the selected candidate
  # pair's local candidate type. Purpose: find out from real users (not
  # just local/dev testing) how often a connection actually needs a TURN
  # relay vs. getting away with a direct host/srflx path, to decide
  # whether standing up a managed TURN server is worth it — see
  # PROJECT_ARCHITECTURE.md's WebRTC section.
  #
  # Logs candidate TYPE only (host/srflx/prflx/relay) — never an IP/port,
  # which the frontend never sends here in the first place (see that
  # function's own comment). No PII in this log line.
  #
  # Deliberately just a Logger.info, not a DB row or a call to an external
  # analytics service — this is meant to be read by grepping logs over a
  # few weeks to inform one infrastructure decision, not a permanent
  # telemetry pipeline.
  @impl true
  def handle_in("report_ice_stats", params, socket) do
    key = {:voice, "report_ice_stats", socket.topic, socket.assigns.user_id}

    unless ChannelRateLimiter.limited?(
             key,
             @ice_stats_scale,
             @ice_stats_limit,
             socket.assigns.user_id,
             "voice_report_ice_stats"
           ) do
      candidate_type = normalize(params["candidate_type"], @valid_candidate_types, "none")

      connection_state =
        normalize(params["connection_state"], @valid_connection_states, "unknown")

      # Feeds Backend.Telemetry.PeriodicReporter's relay-vs-total ratio —
      # only "connected" outcomes count (a "failed" one never selected any
      # candidate to actually use, relay or otherwise, so it wouldn't mean
      # anything in a ratio of "how often did a successful connection need
      # relay").
      if connection_state == "connected" do
        IceStatsCounter.record_connected(candidate_type == "relay")
      end

      Logger.info(
        "voice ICE diagnostic user_id=#{socket.assigns.user_id} room=#{socket.topic} " <>
          "candidate_type=#{candidate_type} connection_state=#{connection_state}"
      )
    end

    {:noreply, socket}
  end

  # Guards against a malicious/buggy client sending an unexpected
  # candidate_type/connection_state value straight into a log line —
  # falls back to a fixed, known-safe placeholder instead.
  defp normalize(value, allowed, default) do
    if value in allowed, do: value, else: default
  end

  defp relay_signal(socket, event, payload) do
    key = {:voice, "signal", socket.topic, socket.assigns.user_id, Map.get(payload, "to")}

    unless ChannelRateLimiter.limited?(
             key,
             @signal_scale,
             @signal_limit,
             socket.assigns.user_id,
             "voice_#{event}"
           ) do
      broadcast_from!(socket, event, Map.put(payload, "from", socket.assigns.user_id))
    end

    {:noreply, socket}
  end
end
