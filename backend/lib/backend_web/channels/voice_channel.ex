defmodule BackendWeb.VoiceChannel do
  use Phoenix.Channel

  alias Backend.Chat
  alias Backend.Servers
  alias Backend.Presence

  @impl true
  def join("voice:" <> room_id, _params, socket) do
    case Chat.get_channel(room_id) do
      nil ->
        {:error, %{reason: "channel not found"}}

      channel ->
        if Servers.member?(channel.server_id, socket.assigns.user_id) do
          # Peers already tracked in this room before we track ourselves
          # below — the joining client uses this list to initiate WebRTC
          # offers, so each pair only negotiates once (no offer/offer glare).
          existing_peers = socket |> Presence.list() |> Map.keys()

          send(self(), :after_join)

          {:ok, %{peers: existing_peers}, socket}
        else
          {:error, %{reason: "not authorized"}}
        end
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    {:ok, _} =
      Presence.track(socket, socket.assigns.user_id, %{
        username: socket.assigns.username,
        online_at: System.system_time(:second),
        muted: false,
        deafened: false
      })

    push(socket, "presence_state", Presence.list(socket))

    {:noreply, socket}
  end

  # Mute/deafen are purely presence metadata — updating it broadcasts a
  # "presence_diff" that every peer's Presence client already listens to
  # (same mechanism that drives the existing participant list), so no
  # separate custom event is needed.
  @impl true
  def handle_in("update_status", %{"muted" => muted, "deafened" => deafened}, socket) do
    {:ok, _} =
      Presence.update(socket, socket.assigns.user_id, fn meta ->
        Map.merge(meta, %{muted: muted, deafened: deafened})
      end)

    {:noreply, socket}
  end

  # SDP offers, SDP answers and ICE candidates are opaque to the server —
  # it only relays them to every other peer in the room. Each payload
  # carries "to"/"from" user ids so the intended recipient can pick it out;
  # "from" is overwritten with the authenticated id so a client can't spoof
  # signaling messages as if they came from someone else.
  @impl true
  def handle_in("video_offer", payload, socket) do
    broadcast_from!(socket, "video_offer", Map.put(payload, "from", socket.assigns.user_id))
    {:noreply, socket}
  end

  @impl true
  def handle_in("video_answer", payload, socket) do
    broadcast_from!(socket, "video_answer", Map.put(payload, "from", socket.assigns.user_id))
    {:noreply, socket}
  end

  @impl true
  def handle_in("ice_candidate", payload, socket) do
    broadcast_from!(socket, "ice_candidate", Map.put(payload, "from", socket.assigns.user_id))
    {:noreply, socket}
  end
end
