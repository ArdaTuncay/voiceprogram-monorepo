defmodule Backend.Servers do
  import Ecto.Query, warn: false

  alias Backend.Repo
  alias Backend.Servers.{Server, ServerMember, Invite}
  alias Backend.Chat.Channel

  @invite_code_alphabet ~c"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  @invite_code_length 7
  @invite_code_max_attempts 5

  @doc "Returns all servers the given user is a member of, ordered by name."
  def list_servers_for_user(user_id) do
    Server
    |> join(:inner, [s], m in ServerMember, on: m.server_id == s.id and m.user_id == ^user_id)
    |> order_by([s], asc: s.name)
    |> Repo.all()
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

  @doc "Returns true if the given user is the owner of the given server."
  def owner?(server_id, user_id) do
    case get_server(server_id) do
      %Server{owner_id: ^user_id} -> true
      _ -> false
    end
  end

  @doc "Returns the user ids of every member of the given server."
  def list_member_user_ids(server_id) do
    ServerMember
    |> where([m], m.server_id == ^server_id)
    |> select([m], m.user_id)
    |> Repo.all()
  end

  @doc "Returns every member of a server with their username and role, ordered by username."
  def list_members(server_id) do
    ServerMember
    |> where([m], m.server_id == ^server_id)
    |> join(:inner, [m], u in Backend.Accounts.User, on: u.id == m.user_id)
    |> order_by([_m, u], asc: u.username)
    |> select([m, u], %{user_id: m.user_id, username: u.username, role: m.role})
    |> Repo.all()
  end

  @doc """
  Renames a server. Broadcasts `"server_updated"` to every member's personal
  `"user:<id>"` topic (see `BackendWeb.UserChannel`) so open clients update
  the name live, whether or not they're currently viewing this server.
  """
  def update_server(%Server{} = server, attrs) do
    server
    |> Server.rename_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        broadcast_to_members(updated.id, "server_updated", %{
          server_id: updated.id,
          name: updated.name
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
        end)

        {:ok, deleted}

      error ->
        error
    end
  end

  @doc """
  Creates a text or voice channel in a server. Broadcasts `"channel_created"`
  to every server member so it appears in their channel list live.
  """
  def create_channel(server_id, attrs) do
    %Channel{}
    |> Channel.changeset(Map.put(attrs, "server_id", server_id))
    |> Repo.insert()
    |> case do
      {:ok, channel} ->
        broadcast_to_members(server_id, "channel_created", %{
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
  to every server member so it disappears from their channel list live.
  """
  def delete_channel(%Channel{} = channel) do
    member_ids = list_member_user_ids(channel.server_id)

    case Repo.delete(channel) do
      {:ok, deleted} ->
        Enum.each(member_ids, fn user_id ->
          BackendWeb.Endpoint.broadcast("user:#{user_id}", "channel_deleted", %{
            channel_id: deleted.id,
            server_id: deleted.server_id
          })
        end)

        {:ok, deleted}

      error ->
        error
    end
  end

  @doc """
  Removes `user_id` from `server_id`. Broadcasts `"member_kicked"` to the
  kicked user (so their client can navigate them out) and to every remaining
  member (so member lists update) — same event, single payload, filtered
  client-side by `user_id`, mirroring `notify_other_members/3` in ChatChannel.

  Returns `{:error, :not_found}` if the user isn't a member.
  """
  def kick_member(server_id, user_id) do
    case Repo.get_by(ServerMember, server_id: server_id, user_id: user_id) do
      nil ->
        {:error, :not_found}

      member ->
        remaining_member_ids =
          server_id |> list_member_user_ids() |> Enum.reject(&(&1 == user_id))

        case Repo.delete(member) do
          {:ok, deleted} ->
            payload = %{server_id: server_id, user_id: user_id}

            [user_id | remaining_member_ids]
            |> Enum.each(&BackendWeb.Endpoint.broadcast("user:#{&1}", "member_kicked", payload))

            {:ok, deleted}

          error ->
            error
        end
    end
  end

  defp broadcast_to_members(server_id, event, payload) do
    server_id
    |> list_member_user_ids()
    |> Enum.each(&BackendWeb.Endpoint.broadcast("user:#{&1}", event, payload))
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
