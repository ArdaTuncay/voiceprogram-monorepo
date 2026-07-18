defmodule Backend.Friends do
  @moduledoc """
  Friend requests and friendships. A single `Friendship` row is directional
  (`user_id` is whoever initiated it, `friend_id` the addressee) and covers
  both a pending request and, once accepted, the friendship itself — there
  is no separate reciprocal row. `status` is one of "pending", "accepted",
  or "blocked".
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts
  alias Backend.Friends.Friendship
  alias Backend.Repo

  @doc "Returns true if `user_id` and `other_id` have an accepted friendship, in either direction."
  def friends?(user_id, other_id) do
    Friendship
    |> where([f], f.status == "accepted")
    |> where(
      [f],
      (f.user_id == ^user_id and f.friend_id == ^other_id) or
        (f.user_id == ^other_id and f.friend_id == ^user_id)
    )
    |> Repo.exists?()
  end

  @doc """
  Sends a friend request from `user_id` to a user resolved from `attrs`
  (`"user_id"` or `"username"`).

  If the target already has a pending request addressed to `user_id` (they
  asked first), this accepts THAT request instead of creating a redundant
  second row — mirrors how a mutual request becomes an instant friendship
  elsewhere.

  Returns `{:ok, friendship}` (preloaded, ready for `to_view/2`) or
  `{:error, reason}` where reason is `:user_not_found`,
  `:cannot_friend_self`, `:already_friends`, `:already_pending`,
  `:blocked_by_you`, `:blocked_by_them`, or an `Ecto.Changeset`.
  """
  def send_request(user_id, attrs) do
    with {:ok, target} <- resolve_target(attrs),
         :ok <- validate_not_self(user_id, target.id) do
      resolve_request(user_id, target.id, find_between(user_id, target.id))
    end
  end

  # Split out of send_request/2 so create_pending/2 can re-run it after
  # losing a race against a concurrent send_request/2 for the same pair —
  # see the comment there. Guards (not repeated plain variables) are what
  # actually enforce "this friendship's user_id/friend_id equals user_id"
  # here, since a bare variable repeated across a function head's arguments
  # doesn't unify the way it would inside a single `case` pattern.
  defp resolve_request(user_id, target_id, nil), do: create_pending(user_id, target_id)

  defp resolve_request(user_id, _target_id, %Friendship{user_id: uid, status: "pending"})
       when uid == user_id,
       do: {:error, :already_pending}

  defp resolve_request(_user_id, _target_id, %Friendship{status: "accepted"}),
    do: {:error, :already_friends}

  defp resolve_request(user_id, _target_id, %Friendship{user_id: uid, status: "blocked"})
       when uid == user_id,
       do: {:error, :blocked_by_you}

  defp resolve_request(user_id, _target_id, %Friendship{friend_id: fid, status: "blocked"})
       when fid == user_id,
       do: {:error, :blocked_by_them}

  defp resolve_request(
         user_id,
         target_id,
         %Friendship{friend_id: fid, status: "pending"} = reciprocal
       )
       when fid == user_id,
       do: accept(reciprocal, target_id)

  @doc """
  Accepts a pending request by its friendship id, on behalf of `user_id`.

  Returns `{:ok, friendship}`, `{:error, :not_found}`,
  `{:error, :not_authorized}` (only the addressee can accept), or
  `{:error, :invalid_state}` (already accepted/blocked).
  """
  def accept_request(user_id, friendship_id) do
    case get_friendship(friendship_id) do
      nil ->
        {:error, :not_found}

      %Friendship{friend_id: ^user_id, status: "pending"} = friendship ->
        accept(friendship, friendship.user_id)

      %Friendship{friend_id: ^user_id} ->
        {:error, :invalid_state}

      %Friendship{} ->
        {:error, :not_authorized}
    end
  end

  @doc """
  Deletes a friendship/request by id, on behalf of `user_id` — covers
  cancelling an outgoing request, rejecting an incoming one, and
  unfriending, all as the same "delete the row" operation. Notifies the
  other party via `"friend_removed"` so their client can drop it too.

  Returns `{:ok, friendship}`, `{:error, :not_found}`, or
  `{:error, :not_authorized}` (neither party).
  """
  def remove_friendship(user_id, friendship_id) do
    case get_friendship(friendship_id) do
      nil ->
        {:error, :not_found}

      %Friendship{user_id: ^user_id} = friendship ->
        delete_and_notify(friendship, friendship.friend_id)

      %Friendship{friend_id: ^user_id} = friendship ->
        delete_and_notify(friendship, friendship.user_id)

      %Friendship{} ->
        {:error, :not_authorized}
    end
  end

  @doc """
  Lists every friendship/request involving `user_id`, each shaped from
  their point of view (see `to_view/2`) — friends, pending requests in
  both directions, and blocks `user_id` themselves initiated. Rows where
  someone else blocked `user_id` are silently excluded (never reveal to a
  user that they've been blocked).
  """
  def list_friendships_for_user(user_id) do
    Friendship
    |> where([f], f.user_id == ^user_id or f.friend_id == ^user_id)
    |> Repo.all()
    |> Repo.preload([:user, :friend])
    |> Enum.reject(&hidden_from?(&1, user_id))
    |> Enum.map(&to_view(&1, user_id))
  end

  @doc """
  Shapes a (preloaded) friendship row from `viewer_id`'s point of view:
  who the *other* person is, and whether this pending request is one
  `viewer_id` sent ("outgoing") or received ("incoming").
  """
  def to_view(%Friendship{} = friendship, viewer_id) do
    {other, direction} =
      if friendship.user_id == viewer_id do
        {friendship.friend, "outgoing"}
      else
        {friendship.user, "incoming"}
      end

    %{
      id: friendship.id,
      status: friendship.status,
      direction: direction,
      user_id: other.id,
      username: other.username,
      user_status: other.status
    }
  end

  defp accept(%Friendship{} = friendship, notify_user_id) do
    case friendship |> Friendship.changeset(%{status: "accepted"}) |> Repo.update() do
      {:ok, updated} ->
        updated = Repo.preload(updated, [:user, :friend])
        notify(notify_user_id, "friend_request_accepted", to_view(updated, notify_user_id))
        {:ok, updated}

      error ->
        error
    end
  end

  defp delete_and_notify(%Friendship{} = friendship, notify_user_id) do
    case Repo.delete(friendship) do
      {:ok, deleted} ->
        notify(notify_user_id, "friend_removed", %{id: deleted.id})
        {:ok, deleted}

      error ->
        error
    end
  end

  defp notify(user_id, event, payload) do
    BackendWeb.Endpoint.broadcast("user:#{user_id}", event, payload)
  end

  defp hidden_from?(%Friendship{status: "blocked", friend_id: friend_id}, user_id),
    do: friend_id == user_id

  defp hidden_from?(_friendship, _user_id), do: false

  defp create_pending(user_id, target_id) do
    case %Friendship{}
         |> Friendship.changeset(%{user_id: user_id, friend_id: target_id, status: "pending"})
         |> Repo.insert() do
      {:ok, friendship} ->
        friendship = Repo.preload(friendship, [:user, :friend])
        notify(target_id, "friend_request_received", to_view(friendship, target_id))
        {:ok, friendship}

      {:error, changeset} = error ->
        if Keyword.has_key?(changeset.errors, :user_id) do
          # Lost a race against a concurrent send_request/2 for the same
          # pair (in either direction) — the other insert already won (see
          # the symmetric unique index in Friendship.changeset/2), so
          # resolve against whatever it just created instead of surfacing a
          # spurious uniqueness error. Re-running resolve_request/3 against
          # the now-visible row handles this exactly like a non-concurrent
          # call would — almost always the "mutual request" auto-accept
          # branch, but every other branch (already blocked, etc.) falls
          # out the same way too.
          resolve_request(user_id, target_id, find_between(user_id, target_id))
        else
          error
        end
    end
  end

  defp find_between(a, b) do
    Friendship
    |> where(
      [f],
      (f.user_id == ^a and f.friend_id == ^b) or (f.user_id == ^b and f.friend_id == ^a)
    )
    |> Repo.one()
  end

  defp get_friendship(id) do
    case Ecto.UUID.cast(id) do
      {:ok, _} -> Repo.get(Friendship, id) |> Repo.preload([:user, :friend])
      :error -> nil
    end
  end

  defp validate_not_self(user_id, user_id), do: {:error, :cannot_friend_self}
  defp validate_not_self(_user_id, _target_id), do: :ok

  defp resolve_target(%{"user_id" => id}) when is_binary(id) and id != "" do
    case Accounts.get_user(id) do
      nil -> {:error, :user_not_found}
      user -> {:ok, user}
    end
  end

  defp resolve_target(%{"username" => username}) when is_binary(username) and username != "" do
    case Accounts.get_user_by_username(username) do
      nil -> {:error, :user_not_found}
      user -> {:ok, user}
    end
  end

  defp resolve_target(_attrs), do: {:error, :user_not_found}
end
