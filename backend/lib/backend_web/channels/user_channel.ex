defmodule BackendWeb.UserChannel do
  @moduledoc """
  Each user's personal `"user:<id>"` notification topic — see the
  `join/3` doc below for what it's used for and how presence on it doubles
  as an online/offline signal.
  """

  use Phoenix.Channel

  alias Backend.{Accounts, Presence, Servers}

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

    {:ok, _} = Presence.track(socket, user_id, %{online_at: System.system_time(:second)})

    unless already_online?, do: set_status(user_id, "online")

    {:noreply, socket}
  end

  @impl true
  def terminate(_reason, socket) do
    user_id = socket.assigns.user_id
    Presence.untrack(socket, user_id)

    unless Presence.list(socket) |> Map.has_key?(user_id), do: set_status(user_id, "offline")

    :ok
  end

  defp set_status(user_id, status) do
    case Accounts.update_status(user_id, status) do
      {:ok, _user} ->
        payload = %{user_id: user_id, status: status}

        user_id
        |> Servers.list_co_member_user_ids()
        |> Enum.each(
          &BackendWeb.Endpoint.broadcast("user:#{&1}", "member_status_changed", payload)
        )

      {:error, _} ->
        :ok
    end
  end
end
