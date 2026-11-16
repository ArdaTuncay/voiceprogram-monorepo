defmodule BackendWeb.UserChannel do
  @moduledoc """
  Each user's personal `"user:<id>"` notification topic — see the
  `join/3` doc below for what it's used for and how presence on it doubles
  as an online/offline signal.
  """

  use Phoenix.Channel

  alias Backend.{Presence, Servers}

  # A user's personal notification topic — used to relay "new_message" events
  # (see ChatChannel) for channels the user isn't currently viewing, plus
  # server-moderation events. Only the authenticated owner of this id may
  # join it. Every open tab/device joins this same topic (see
  # useSocketStore.ts), which doubles as a way to track "is this user
  # connected anywhere at all" below.
  @impl true
  def join("user:" <> user_id, _params, socket) do
    if user_id == socket.assigns.user_id do
      send(self(), :after_join)
      {:ok, socket}
    else
      {:error, %{reason: "not authorized"}}
    end
  end

  # Presence on this topic is only ever self-tracked (only the owning user
  # can join it), so it's really a ref-count of how many tabs/devices this
  # one user currently has connected — not "who else is here". That's what
  # makes a naive "set offline on disconnect" safe against a user with two
  # tabs open closing just one: we only flip the DB status when the
  # *last* remaining presence for this user_id goes away, checked via
  # Presence.list right after track/untrack (both are synchronous calls to
  # the Presence tracker, so there's no race with concurrent joins/leaves).
  @impl true
  def handle_info(:after_join, socket) do
    user_id = socket.assigns.user_id
    already_online? = Presence.list(socket) |> Map.has_key?(user_id)
    socket = follow_servers(socket)

    {:ok, _} = Presence.track(socket, user_id, %{online_at: System.system_time(:second)})

    unless already_online?, do: set_status(user_id, "online")

    # Every app load joins this topic, well before the user opens a voice
    # channel — the moment to make sure their TURN credential exists and
    # has had time to propagate (see Backend.Turn.prewarm/1).
    Backend.Turn.prewarm(user_id)

    {:noreply, socket}
  end

  # A message in one of the user's servers (see Servers.broadcast_new_message/2)
  # — relayed unless it's their own.
  def handle_info({:new_message, payload}, socket) do
    if payload.user_id != socket.assigns.user_id, do: push(socket, "new_message", payload)
    {:noreply, socket}
  end

  def handle_info({:server_membership_added, server_id}, socket),
    do: {:noreply, follow(socket, server_id)}

  # Kicked, banned, left, or the server was deleted (see
  # Servers.revoke_channel_access/2). Unlike the server-scoped channels, this
  # one stays open — it only stops hearing about that server.
  def handle_info({:server_membership_revoked, server_id}, socket),
    do: {:noreply, unfollow(socket, server_id)}

  @impl true
  def terminate(_reason, socket) do
    user_id = socket.assigns.user_id
    Presence.untrack(socket, user_id)

    unless Presence.list(socket) |> Map.has_key?(user_id), do: set_status(user_id, "offline")

    :ok
  end

  # Tells everyone who shares a server with `user_id` that they came
  # online/went offline. Nothing is stored — readers derive status from
  # Presence (see Backend.Accounts.online?/1).
  defp set_status(user_id, status) do
    payload = %{user_id: user_id, status: status}

    user_id
    |> Servers.list_co_member_user_ids()
    |> Enum.each(&BackendWeb.Endpoint.broadcast("user:#{&1}", "member_status_changed", payload))
  end

  # Listens on the notifications topic of every server the user is in (see
  # Servers.notifications_topic/1), and on what keeps that list right: joins
  # (Servers.user_servers_topic/1) and removals (Servers.membership_topic/2).
  #
  # Join announcements are listened for before the list is read, so a join
  # in between isn't missed (and `follow/2` ignores a server it already
  # follows). A removal in between would be — the list is read again
  # afterwards and anything no longer in it dropped.
  defp follow_servers(socket) do
    user_id = socket.assigns.user_id
    :ok = Phoenix.PubSub.subscribe(Backend.PubSub, Servers.user_servers_topic(user_id))
    socket = assign(socket, :followed_servers, MapSet.new())

    socket =
      user_id
      |> Servers.list_server_ids_for_user()
      |> Enum.reduce(socket, &follow(&2, &1))

    still_member = MapSet.new(Servers.list_server_ids_for_user(user_id))

    socket.assigns.followed_servers
    |> Enum.reject(&MapSet.member?(still_member, &1))
    |> Enum.reduce(socket, &unfollow(&2, &1))
  end

  defp follow(socket, server_id) do
    if MapSet.member?(socket.assigns.followed_servers, server_id) do
      socket
    else
      :ok = Servers.subscribe_to_membership(server_id, socket.assigns.user_id)
      :ok = Phoenix.PubSub.subscribe(Backend.PubSub, Servers.notifications_topic(server_id))
      assign(socket, :followed_servers, MapSet.put(socket.assigns.followed_servers, server_id))
    end
  end

  defp unfollow(socket, server_id) do
    if MapSet.member?(socket.assigns.followed_servers, server_id) do
      Phoenix.PubSub.unsubscribe(
        Backend.PubSub,
        Servers.membership_topic(server_id, socket.assigns.user_id)
      )

      Phoenix.PubSub.unsubscribe(Backend.PubSub, Servers.notifications_topic(server_id))
      assign(socket, :followed_servers, MapSet.delete(socket.assigns.followed_servers, server_id))
    else
      socket
    end
  end
end
