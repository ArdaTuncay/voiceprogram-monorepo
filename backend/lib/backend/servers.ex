defmodule Backend.Servers do
  @moduledoc """
  Servers (Discord-style "guilds"), their members, and invite codes. A
  server always has exactly one owner (the creator) — ownership can't be
  transferred and the owner can't leave via `leave_server/2`, only delete
  the whole server via `delete_server/1`.
  """

  import Ecto.Query, warn: false

  alias Backend.Chat
  alias Backend.Chat.Channel
  alias Backend.Repo
  alias Backend.Servers.{Invite, Server, ServerBan, ServerMember}

  @invite_code_alphabet ~c"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  @invite_code_length 7
  @invite_code_max_attempts 5

  @doc """
  Returns all servers the given user is a member of, ordered by name, each
  with the user's own role in it as the virtual `:my_role` field.
  """
  def list_servers_for_user(user_id) do
    Server
    |> join(:inner, [s], m in ServerMember, on: m.server_id == s.id and m.user_id == ^user_id)
    |> order_by([s], asc: s.name)
    |> select([s, m], {s, m.role})
    |> Repo.all()
    |> Enum.map(fn {server, role} -> %{server | my_role: role} end)
  end

  @doc """
  Creates a server owned by `user_id`, adds the owner as a member, and seeds
  a default "genel" text channel — all in one transaction.
  """
  def create_server(attrs, user_id) do
    Repo.transaction(fn ->
      with {:ok, server} <-
             %Server{}
             |> Server.changeset(Map.put(attrs, "owner_id", user_id))
             |> Repo.insert(),
           {:ok, _member} <-
             %ServerMember{}
             |> ServerMember.changeset(%{server_id: server.id, user_id: user_id, role: "owner"})
             |> Repo.insert(),
           {:ok, _channel} <-
             %Channel{}
             |> Channel.changeset(%{name: "genel", type: "text", server_id: server.id})
             |> Repo.insert() do
        server
      else
        {:error, changeset} -> Repo.rollback(changeset)
      end
    end)
  end

  @doc "Fetches a server by id. Returns `nil` if not found or the id isn't a valid UUID."
  def get_server(id) do
    case Ecto.UUID.cast(id) do
      {:ok, _} -> Repo.get(Server, id)
      :error -> nil
    end
  end

  @doc "Returns true if the given user is a member of the given server."
  def member?(server_id, user_id) do
    Repo.exists?(
      from m in ServerMember, where: m.server_id == ^server_id and m.user_id == ^user_id
    )
  end

  @doc """
  The PubSub topic a server-scoped channel process (`BackendWeb.ChatChannel`,
  `BackendWeb.VoiceChannel`, `BackendWeb.ServerChannel`) listens on for
  "`user_id` is no longer a member of `server_id`" — see
  `revoke_channel_access/2`.
  """
  def membership_topic(server_id, user_id), do: "server_membership:#{server_id}:#{user_id}"

  @doc """
  Subscribes the calling channel process to `membership_topic/2`.

  Channels call this from `join/3` *before* checking `member?/2`, not
  after: subscribing first means a kick that lands between the membership
  check and the subscription still reaches this process (it was already
  listening), instead of slipping through the gap and leaving a joined
  process that never hears about it.
  """
  def subscribe_to_membership(server_id, user_id) do
    Phoenix.PubSub.subscribe(Backend.PubSub, membership_topic(server_id, user_id))
  end

  @doc """
  Tells every channel process `user_id` still has open for `server_id` that
  their membership just ended (kicked, left, account deleted, or the server
  itself deleted). Each one pushes `"access_revoked"` and stops with
  `{:shutdown, :membership_revoked}` — a graceful close, so the client gets
  `phx_close` and doesn't auto-rejoin.

  `member?/2` is only checked at join time; without this, an already-joined
  process kept relaying that user's messages and voice signaling after
  they'd been removed, trusting their own client to leave on its own.
  """
  def revoke_channel_access(server_id, user_id) do
    Phoenix.PubSub.broadcast(
      Backend.PubSub,
      membership_topic(server_id, user_id),
      {:server_membership_revoked, server_id}
    )
  end

  @doc "Returns true if the given user is the owner of the given server."
  def owner?(server_id, user_id) do
    case get_server(server_id) do
      %Server{owner_id: ^user_id} -> true
      _ -> false
    end
  end

  @doc ~s|The user's role in the server ("owner", "moderator" or "member"), or nil if not a member.|
  def role_of(server_id, user_id) do
    ServerMember
    |> where([m], m.server_id == ^server_id and m.user_id == ^user_id)
    |> select([m], m.role)
    |> Repo.one()
  end

  @doc "True if the user is the server's owner or one of its moderators."
  def moderator?(server_id, user_id), do: role_of(server_id, user_id) in ["owner", "moderator"]

  @doc """
  True if `actor_id` may kick, ban or delete the messages of `target_id` in
  the server. The owner can act on anyone but themselves; a moderator only
  on regular members (or non-members, for a pre-emptive ban) — never on the
  owner or another moderator. Everyone else can't act on anyone.
  """
  def can_moderate?(_server_id, actor_id, actor_id), do: false

  def can_moderate?(server_id, actor_id, target_id) do
    case role_of(server_id, actor_id) do
      "owner" -> true
      "moderator" -> role_of(server_id, target_id) in ["member", nil]
      _ -> false
    end
  end

  @assignable_roles ~w(member moderator)

  @doc """
  Sets a member's role to `"member"` or `"moderator"`. The owner's role
  can't change this way (ownership isn't transferable). The caller checks
  that the actor is the owner. Announces `"member_role_updated"` to the
  server and to the member's own topic, so their client unlocks or hides
  the moderation controls live.

  Returns `{:ok, member}`, `{:error, :not_found}`, `{:error, :owner}`, or
  `{:error, :invalid_role}`.
  """
  def set_member_role(server_id, user_id, role) when role in @assignable_roles do
    case Repo.get_by(ServerMember, server_id: server_id, user_id: user_id) do
      nil ->
        {:error, :not_found}

      %ServerMember{role: "owner"} ->
        {:error, :owner}

      member ->
        with {:ok, updated} <- member |> ServerMember.changeset(%{role: role}) |> Repo.update() do
          payload = %{server_id: server_id, user_id: user_id, role: role}
          BackendWeb.Endpoint.broadcast("user:#{user_id}", "member_role_updated", payload)
          broadcast_to_server(server_id, "member_role_updated", payload)
          {:ok, updated}
        end
    end
  end

  def set_member_role(_server_id, _user_id, _role), do: {:error, :invalid_role}

  @doc "The user ids of the server's owner and moderators."
  def list_moderator_ids(server_id) do
    ServerMember
    |> where([m], m.server_id == ^server_id and m.role in ["owner", "moderator"])
    |> select([m], m.user_id)
    |> Repo.all()
  end

  @doc "Returns the user ids of every member of the given server."
  def list_member_user_ids(server_id) do
    ServerMember
    |> where([m], m.server_id == ^server_id)
    |> select([m], m.user_id)
    |> Repo.all()
  end

  @doc "Returns every member of a server with their username, role, and online status, ordered by username."
  def list_members(server_id) do
    ServerMember
    |> where([m], m.server_id == ^server_id)
    |> join(:inner, [m], u in Backend.Accounts.User, on: u.id == m.user_id)
    |> order_by([_m, u], asc: u.username)
    |> select([m, u], %{
      user_id: m.user_id,
      username: u.username,
      avatar_url: u.avatar_url,
      role: m.role
    })
    |> Repo.all()
    |> Enum.map(&Map.put(&1, :status, Backend.Accounts.status(&1.user_id)))
  end

  @doc """
  Returns the distinct user ids that share at least one server with
  `user_id` (excluding `user_id` itself). Used to fan out
  `"member_status_changed"` broadcasts (see `BackendWeb.UserChannel`) to
  everyone who'd plausibly want to know — no separate "who's watching
  whom" subscription list needed.
  """
  def list_co_member_user_ids(user_id) do
    my_server_ids =
      ServerMember
      |> where([m], m.user_id == ^user_id)
      |> select([m], m.server_id)

    ServerMember
    |> where([m], m.server_id in subquery(my_server_ids) and m.user_id != ^user_id)
    |> distinct(true)
    |> select([m], m.user_id)
    |> Repo.all()
  end

  @doc """
  Renames a server. Broadcasts `"server_updated"` once to the shared
  `"server:<id>"` topic (see `BackendWeb.ServerChannel`) — every member
  currently viewing this server gets it live; members elsewhere pick up the
  new name next time they open it (see `list_servers_for_user/1`).
  """
  def update_server(%Server{} = server, attrs) do
    server |> Server.rename_changeset(attrs) |> update_and_announce()
  end

  @doc """
  Sets or clears the server icon (see `Server.icon_changeset/2`) and
  announces it the same way a rename is (`"server_updated"`).
  """
  def update_server_icon(%Server{} = server, icon_url) do
    server |> Server.icon_changeset(%{icon_url: icon_url}) |> update_and_announce()
  end

  defp update_and_announce(changeset) do
    case Repo.update(changeset) do
      {:ok, updated} ->
        broadcast_to_server(updated.id, "server_updated", %{
          server_id: updated.id,
          name: updated.name,
          icon_url: updated.icon_url
        })

        {:ok, updated}

      error ->
        error
    end
  end

  @doc """
  Permanently deletes a server (cascades to its channels, members, invites,
  and messages). Broadcasts `"server_deleted"` to every member so their
  clients can drop it from the server list and navigate away if it was open.
  """
  def delete_server(%Server{} = server) do
    member_ids = list_member_user_ids(server.id)

    case Repo.delete(server) do
      {:ok, deleted} ->
        Enum.each(member_ids, fn user_id ->
          BackendWeb.Endpoint.broadcast("user:#{user_id}", "server_deleted", %{
            server_id: deleted.id
          })

          revoke_channel_access(deleted.id, user_id)
        end)

        {:ok, deleted}

      error ->
        error
    end
  end

  @doc """
  Creates a text, voice, or category channel in a server. Broadcasts
  `"channel_created"` once to the shared `"server:<id>"` topic so it appears
  live for everyone currently viewing this server.
  """
  def create_channel(server_id, attrs) do
    %Channel{}
    |> Channel.changeset(Map.put(attrs, "server_id", server_id))
    |> Repo.insert()
    |> case do
      {:ok, channel} ->
        broadcast_to_server(server_id, "channel_created", %{
          id: channel.id,
          name: channel.name,
          type: channel.type,
          server_id: server_id
        })

        {:ok, channel}

      error ->
        error
    end
  end

  @doc """
  Permanently deletes a text or voice channel. Broadcasts `"channel_deleted"`
  once to the shared `"server:<id>"` topic so it disappears live for
  everyone currently viewing this server.
  """
  def delete_channel(%Channel{} = channel) do
    case Repo.delete(channel) do
      {:ok, deleted} ->
        broadcast_to_server(deleted.server_id, "channel_deleted", %{
          channel_id: deleted.id,
          server_id: deleted.server_id
        })

        {:ok, deleted}

      error ->
        error
    end
  end

  @doc """
  Bulk-updates a server's channels' `parent_id`/`position` in one
  transaction — covers both moving a channel into/out of a category and
  reordering siblings, since both are just a new `(parent_id, position)`
  pair. `updates` is a list of `%{id: channel_id, parent_id: parent_id_or_nil,
  position: position}` maps; only channels actually belonging to `server_id`
  are touched (scoped the same way `delete_channel/1`'s caller already scopes
  by server, so a client can't move another server's channel by guessing its
  id). All-or-nothing: the first invalid update rolls the whole batch back.

  Broadcasts `"channel_positions_updated"` once to the shared `"server:<id>"`
  topic with the server's full, freshly-ordered channel list — simpler for
  every client to reconcile than a diff, and no different in cost than the
  full refetch `loadChannelsForActiveServer` already does on a plain reload.

  Returns `{:ok, channels}` or `{:error, :not_found | changeset}`.
  """
  def update_channel_positions(server_id, updates) do
    Repo.transaction(fn ->
      Enum.each(updates, &apply_position_update(server_id, &1))
    end)
    |> case do
      {:ok, _} ->
        channels = Chat.list_channels_for_server(server_id)

        broadcast_to_server(server_id, "channel_positions_updated", %{
          server_id: server_id,
          channels: Enum.map(channels, &channel_position_json/1)
        })

        {:ok, channels}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp apply_position_update(server_id, %{id: id} = update) do
    case Repo.get_by(Channel, id: id, server_id: server_id) do
      nil ->
        Repo.rollback(:not_found)

      channel ->
        attrs = Map.take(update, [:parent_id, :position])

        case channel |> Channel.position_changeset(attrs) |> Repo.update() do
          {:ok, _updated} -> :ok
          {:error, changeset} -> Repo.rollback(changeset)
        end
    end
  end

  defp channel_position_json(channel) do
    %{
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parent_id: channel.parent_id,
      position: channel.position
    }
  end

  @doc """
  Removes `user_id` from `server_id`. Broadcasts `"member_kicked"` to the
  kicked user's own personal `"user:<id>"` topic specifically — they need to
  know and navigate away regardless of whether they currently have this
  server open — and `"member_left"` once to the shared `"server:<id>"` topic
  so everyone else currently viewing it updates live.

  Returns `{:error, :not_found}` if the user isn't a member.
  """
  def kick_member(server_id, user_id) do
    case Repo.get_by(ServerMember, server_id: server_id, user_id: user_id) do
      nil ->
        {:error, :not_found}

      member ->
        case Repo.delete(member) do
          {:ok, deleted} ->
            announce_removal(server_id, user_id, %{})
            {:ok, deleted}

          error ->
            error
        end
    end
  end

  @doc "True if `user_id` is banned from `server_id`."
  def banned?(server_id, user_id) do
    Repo.exists?(from b in ServerBan, where: b.server_id == ^server_id and b.user_id == ^user_id)
  end

  @doc """
  Bans `user_id` from `server_id`: records the ban (or updates its reason
  if they're already banned) and, if they're a member, removes them the
  same way `kick_member/2` does — "member_kicked" (with `banned: true`) to
  them, "member_left" to the server, and their open channels closed. A
  banned user can't rejoin through any invite (`accept_invite/2`) until
  `unban_user/2`. Users who aren't members can be banned pre-emptively.

  The owner can't be banned; the caller checks that the actor is the owner.
  Returns `{:ok, ban}`, `{:error, :owner}`, or `{:error, changeset}`.
  """
  def ban_user(%Server{owner_id: owner_id}, owner_id, _banned_by_id, _reason),
    do: {:error, :owner}

  def ban_user(%Server{} = server, user_id, banned_by_id, reason) do
    Repo.transaction(fn ->
      attrs = %{
        server_id: server.id,
        user_id: user_id,
        banned_by_id: banned_by_id,
        reason: reason
      }

      insert =
        %ServerBan{}
        |> ServerBan.changeset(attrs)
        |> Repo.insert(
          on_conflict: {:replace, [:reason, :banned_by_id, :updated_at]},
          conflict_target: [:server_id, :user_id],
          returning: true
        )

      case insert do
        {:ok, ban} ->
          {removed, _} =
            ServerMember
            |> where([m], m.server_id == ^server.id and m.user_id == ^user_id)
            |> Repo.delete_all()

          {ban, removed > 0}

        {:error, changeset} ->
          Repo.rollback(changeset)
      end
    end)
    |> case do
      {:ok, {ban, was_member?}} ->
        if was_member?, do: announce_removal(server.id, user_id, %{banned: true})
        {:ok, ban}

      error ->
        error
    end
  end

  @doc "Lifts a ban. Returns `{:ok, ban}` or `{:error, :not_found}`."
  def unban_user(server_id, user_id) do
    case Repo.get_by(ServerBan, server_id: server_id, user_id: user_id) do
      nil -> {:error, :not_found}
      ban -> Repo.delete(ban)
    end
  end

  @doc "The server's bans, newest first, with the banned user's display name."
  def list_bans(server_id) do
    ServerBan
    |> where([b], b.server_id == ^server_id)
    |> order_by([b], desc: b.inserted_at)
    |> preload(:user)
    |> Repo.all()
    |> Enum.map(fn ban ->
      %{
        user_id: ban.user_id,
        username: Backend.Accounts.display_username(ban.user),
        reason: ban.reason,
        banned_at: ban.inserted_at
      }
    end)
  end

  # What every forced removal (kick or ban) tells everyone involved.
  defp announce_removal(server_id, user_id, extra) do
    payload = %{server_id: server_id, user_id: user_id}
    BackendWeb.Endpoint.broadcast("user:#{user_id}", "member_kicked", Map.merge(payload, extra))
    broadcast_to_server(server_id, "member_left", payload)
    revoke_channel_access(server_id, user_id)
  end

  @doc """
  Removes `user_id` from `server_id` at their own request. The owner cannot
  leave this way — they must delete the server instead (see
  `delete_server/1`) since a server with no owner would be broken.

  Broadcasts `"member_left"` once to the shared `"server:<id>"` topic (the
  leaving user already knows — they initiated it — so this is purely for
  everyone else currently viewing the server).

  Returns `{:error, :owner_cannot_leave}` for the owner, or
  `{:error, :not_found}` if `user_id` isn't a member.
  """
  def leave_server(server_id, user_id) do
    case get_server(server_id) do
      %Server{owner_id: ^user_id} ->
        {:error, :owner_cannot_leave}

      %Server{} ->
        remove_member(server_id, user_id)

      nil ->
        {:error, :not_found}
    end
  end

  defp remove_member(server_id, user_id) do
    case Repo.get_by(ServerMember, server_id: server_id, user_id: user_id) do
      nil ->
        {:error, :not_found}

      member ->
        case Repo.delete(member) do
          {:ok, deleted} ->
            broadcast_to_server(server_id, "member_left", %{
              server_id: server_id,
              user_id: user_id
            })

            revoke_channel_access(server_id, user_id)
            {:ok, deleted}

          error ->
            error
        end
    end
  end

  defp broadcast_to_server(server_id, event, payload) do
    BackendWeb.Endpoint.broadcast("server:#{server_id}", event, payload)
  end

  @doc """
  Generates a unique invite code for `server_id` on behalf of `inviter_id`.

  `attrs` may include `:expires_at` (`DateTime` or `nil`) and `:max_uses`
  (positive integer or `nil` for unlimited uses).
  """
  def create_invite(server_id, inviter_id, attrs \\ %{}) do
    attrs = Map.merge(attrs, %{server_id: server_id, inviter_id: inviter_id})
    do_create_invite(attrs, @invite_code_max_attempts)
  end

  @doc "Lists every invite ever created for a server, most recently created first."
  def list_invites(server_id) do
    Invite
    |> where([i], i.server_id == ^server_id)
    |> order_by([i], desc: i.inserted_at)
    |> Repo.all()
  end

  @doc """
  Deletes an invite, scoped to `server_id` so an owner can't revoke another
  server's invite by guessing its id. Returns `{:error, :not_found}` if the
  id isn't a valid UUID, doesn't exist, or belongs to a different server.
  """
  def revoke_invite(invite_id, server_id) do
    case Ecto.UUID.cast(invite_id) do
      :error ->
        {:error, :not_found}

      {:ok, _} ->
        case Repo.get_by(Invite, id: invite_id, server_id: server_id) do
          nil -> {:error, :not_found}
          invite -> Repo.delete(invite)
        end
    end
  end

  defp do_create_invite(_attrs, 0), do: {:error, :code_generation_failed}

  defp do_create_invite(attrs, attempts_left) do
    changeset =
      %Invite{}
      |> Invite.changeset(Map.put(attrs, :code, generate_invite_code()))

    case Repo.insert(changeset) do
      {:ok, invite} ->
        {:ok, invite}

      {:error, changeset} ->
        if Keyword.has_key?(changeset.errors, :code) do
          do_create_invite(attrs, attempts_left - 1)
        else
          {:error, changeset}
        end
    end
  end

  defp generate_invite_code do
    for _ <- 1..@invite_code_length, into: "", do: <<Enum.random(@invite_code_alphabet)>>
  end

  @doc """
  Validates an invite `code` and, if valid, adds `user_id` as a member of its
  server. Already-members are treated as a no-op success (idempotent accept).

  Returns `{:ok, server}` or `{:error, :not_found | :expired | :max_uses_reached}`.
  """
  def accept_invite(code, user_id) do
    case Repo.get_by(Invite, code: code) do
      nil ->
        {:error, :not_found}

      invite ->
        cond do
          invite_expired?(invite) -> {:error, :expired}
          invite_maxed_out?(invite) -> {:error, :max_uses_reached}
          banned?(invite.server_id, user_id) -> {:error, :banned}
          member?(invite.server_id, user_id) -> {:ok, get_server(invite.server_id)}
          true -> do_accept_invite(invite, user_id)
        end
    end
  end

  defp invite_expired?(%Invite{expires_at: nil}), do: false

  defp invite_expired?(%Invite{expires_at: expires_at}),
    do: DateTime.compare(DateTime.utc_now(), expires_at) != :lt

  defp invite_maxed_out?(%Invite{max_uses: nil}), do: false
  defp invite_maxed_out?(%Invite{max_uses: max, uses_count: count}), do: count >= max

  defp do_accept_invite(invite, user_id) do
    result =
      Repo.transaction(fn ->
        with {:ok, _member} <-
               %ServerMember{}
               |> ServerMember.changeset(%{
                 server_id: invite.server_id,
                 user_id: user_id,
                 role: "member"
               })
               |> Repo.insert(),
             {1, _} <-
               Invite
               |> where([i], i.id == ^invite.id)
               |> Repo.update_all(inc: [uses_count: 1]) do
          get_server(invite.server_id)
        else
          {:error, changeset} -> Repo.rollback(changeset)
        end
      end)

    case result do
      {:ok, server} -> {:ok, server}
      {:error, changeset} -> {:error, changeset}
    end
  end
end
