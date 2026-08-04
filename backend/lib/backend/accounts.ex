defmodule Backend.Accounts do
  @moduledoc """
  User registration, authentication (token-based, via `Phoenix.Token`), and
  online/offline status.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Friends.Friendship
  alias Backend.Repo
  alias Backend.Servers.{Server, ServerMember}
  alias Ecto.Multi

  # Ecto.Multi is otherwise unused anywhere in this codebase (see
  # PROJECT_ARCHITECTURE.md's known-gaps table) — delete_account/2 below is
  # the first caller, and it's what first surfaces a long-standing Dialyzer
  # false positive: %Ecto.Multi{}'s :names field wraps a MapSet, whose
  # internal representation is genuinely `@opaque`, and Dialyzer's PLT
  # (built from this project's exact Elixir/OTP pair) reports a
  # call_without_opaque mismatch on Multi.new/0's own result being piped
  # into Multi.run/3 — a mismatch entirely inside Ecto's own compiled code,
  # not anything build_deletion_multi/1 itself does. Confirmed harmless by
  # the full Backend.AccountsTest suite (including an atomicity test that
  # forces a real mid-transaction failure and asserts nothing committed).
  @dialyzer {:no_opaque, build_deletion_multi: 1}

  @token_salt "user socket"
  @token_max_age 60 * 60 * 24

  @doc "Registers a new user with hashed password."
  def create_user(attrs) do
    %User{}
    |> User.registration_changeset(attrs)
    |> Repo.insert()
  end

  @doc "Fetches a user by email. Returns nil if not found."
  def get_user_by_email(email) when is_binary(email) do
    Repo.get_by(User, email: email)
  end

  @doc "Fetches a user by id. Returns nil if not found."
  def get_user(id) do
    Repo.get(User, id)
  end

  @doc "Fetches a user by username. Returns nil if not found."
  def get_user_by_username(username) when is_binary(username) do
    Repo.get_by(User, username: username)
  end

  @doc """
  Authenticates a user by email and password.

  Returns `{:ok, user}` on success, or `{:error, :invalid_credentials}`.
  Uses a constant-time dummy hash check when the user does not exist to
  prevent user-enumeration via timing differences.
  """
  def authenticate_user(email, password) do
    user = get_user_by_email(email)

    cond do
      user && Pbkdf2.verify_pass(password, user.password_hash) ->
        {:ok, user}

      user ->
        {:error, :invalid_credentials}

      true ->
        # Prevent timing attacks: always run a hash operation even when user not found.
        Pbkdf2.no_user_verify()
        {:error, :invalid_credentials}
    end
  end

  @doc """
  Signs a token identifying the given user, valid for 24 hours (subject to
  early invalidation — see `authenticate_token/1`). The signed payload
  carries `token_version` alongside the user id so verification can check
  it against the user's *current* `token_version` column.

  This used to compare wall-clock timestamps (`signed_at` vs. a
  `token_valid_from` column) instead, but that was racy: two
  `DateTime.utc_now()` reads close together can compare equal rather than
  older whenever OS clock resolution exceeds the real gap between them (as
  little as ~15ms on this project's Windows dev host — the same class of
  bug that hit `messages.inserted_at`, see the `add_seq_to_messages`
  migration), and the old check treated "not older" as still valid — so an
  actually-revoked token could occasionally keep working. A plain integer
  bumped by exactly 1 per revocation has no clock to race: validity is a
  DB-consistent equality check, not a timestamp comparison.
  """
  def generate_user_token(user) do
    payload = %{user_id: user.id, token_version: user.token_version}
    Phoenix.Token.sign(BackendWeb.Endpoint, @token_salt, payload)
  end

  @doc """
  Verifies a token produced by `generate_user_token/1` and returns the user
  it identifies.

  Rejects the token (as `{:error, :invalid}`) if the signature/max_age check
  fails, the user no longer exists, or — the point of this check — the
  token's `token_version` no longer matches the user's current one (bumped
  on password change and by `POST /api/users/logout_all`), so tokens issued
  before a security-relevant event stop working immediately instead of
  lingering until their natural 24h expiry.
  """
  def authenticate_token(token) do
    with {:ok, %{user_id: user_id, token_version: token_version}} <-
           Phoenix.Token.verify(BackendWeb.Endpoint, @token_salt, token, max_age: @token_max_age),
         %User{} = user <- get_user(user_id),
         true <- token_version == user.token_version do
      {:ok, user}
    else
      _ -> {:error, :invalid}
    end
  end

  @doc """
  Bumps `token_version`, invalidating every token issued before this call —
  used by `POST /api/users/logout_all` to force every other (and this)
  device to re-authenticate.

  Increments atomically at the DB level (`Repo.update_all/3` with `inc:`)
  rather than reading `user.token_version`, adding 1 in Elixir, and writing
  that back — a read-modify-write would let two concurrent revocations
  (e.g. "logout everywhere" double-clicked, or fired from two devices at
  once) both read the same starting value and each write the same `+1`,
  silently losing one of the two increments.
  """
  def revoke_all_tokens(%User{id: id}) do
    query = from(u in User, where: u.id == ^id, select: u)

    case Repo.update_all(query, inc: [token_version: 1]) do
      {1, [user]} -> {:ok, user}
      {0, []} -> {:error, :not_found}
    end
  end

  @doc """
  Verifies a plaintext password against a user's stored hash — the same
  constant-time-safe pattern `authenticate_user/2` uses (a dummy hash op
  when verification fails, so a wrong-password response takes the same
  time whether or not it also happened to be a real user's password),
  extracted so callers that need to gate a sensitive account change on
  re-entering the current password (see `update_username/2`/`update_email/2`'s
  controller) don't duplicate the `Pbkdf2` calls themselves.
  """
  def verify_password?(%User{password_hash: password_hash}, password) do
    if Pbkdf2.verify_pass(password, password_hash) do
      true
    else
      Pbkdf2.no_user_verify()
      false
    end
  end

  @doc """
  Updates a user's username, subject to the same format/length/uniqueness
  rules as registration. Returns `{:error, changeset}` (with a "has already
  been taken" error on `:username`) if it collides with another user —
  the DB's own unique index (see the `create_users` migration) is what
  actually enforces this under a race; `unique_constraint/2` on the
  changeset just turns that into a normal validation error instead of a
  raised `Ecto.ConstraintError`.

  Does not itself check a current password — that's the caller's
  responsibility (see `verify_password?/2`), same division as
  `update_email/2`.
  """
  def update_username(%User{} = user, new_username) do
    user
    |> User.username_changeset(%{"username" => new_username})
    |> Repo.update()
  end

  @doc """
  Updates a user's email. No confirmation step — see
  `Backend.Accounts.User.email_changeset/2`'s moduledoc for why. Same
  unique-collision behavior as `update_username/2`.
  """
  def update_email(%User{} = user, new_email) do
    user
    |> User.email_changeset(%{"email" => new_email})
    |> Repo.update()
  end

  @doc """
  Changes a user's password after verifying `current_password` against the
  stored hash. Returns `{:error, :invalid_current_password}` (not a
  changeset) when that check fails, so the controller can tell "wrong
  current password" apart from "new password too short" without pattern
  matching into changeset error details.

  On success, invalidates every previously issued token for this user —
  see `Backend.Accounts.User.password_changeset/2`'s moduledoc for how
  (it's the same `hash_password/1` hook `registration_changeset/2` uses,
  not a separate call to `revoke_all_tokens/1`).
  """
  def update_password(%User{} = user, current_password, new_password) do
    if verify_password?(user, current_password) do
      user
      |> User.password_changeset(%{"password" => new_password})
      |> Repo.update()
    else
      {:error, :invalid_current_password}
    end
  end

  @doc """
  Updates whether `user` accepts friend requests from everyone or no one
  (see `Backend.Accounts.User.friend_request_privacy_changeset/2`) — no
  current-password re-auth, unlike update_username/2's callers: this is a
  privacy preference, not a sensitive identity field.
  """
  def update_friend_request_privacy(%User{} = user, privacy) do
    user
    |> User.friend_request_privacy_changeset(%{"friend_request_privacy" => privacy})
    |> Repo.update()
  end

  @doc """
  Updates the online/offline status of a user by id.

  Returns `{:error, :not_found}` if `user_id` doesn't exist (shouldn't
  happen in practice — only called with an already-authenticated socket's
  own user id, see `BackendWeb.UserChannel`).
  """
  def update_status(user_id, status) when status in ["online", "offline"] do
    case get_user(user_id) do
      nil -> {:error, :not_found}
      user -> user |> Ecto.Changeset.change(status: status) |> Repo.update()
    end
  end

  @doc """
  The name to show for a message/DM author, or a DM room's other
  participant — `"[silinmiş kullanıcı]"` once `User.deleted?/1` is true,
  their real (anonymized, meaningless) `username` otherwise. This is the
  single place that decision is made; every serializer that surfaces a
  user's name to another user's client should call this instead of
  reading `user.username` directly, so a deleted account can never leak
  its pre-deletion identity through a stale cached username column.
  """
  def display_username(nil), do: nil

  def display_username(%User{} = user),
    do: if(User.deleted?(user), do: "[silinmiş kullanıcı]", else: user.username)

  @doc """
  Permanently and irreversibly deletes/anonymizes `user`'s account, after
  verifying `current_password`. All-or-nothing (a single `Ecto.Multi`
  transaction) — see PROJECT_ARCHITECTURE.md's account deletion section
  for the full data map this implements. In order:

    1. Every server `user` owns: if it has other members, ownership
       transfers to whoever joined earliest (excluding `user`); if not,
       the server (and its channels/messages/reactions/invites) is
       deleted outright via the DB's own cascade.
    2. Every server-membership row `user` still holds afterward (regular
       memberships elsewhere, and their now-stale membership on any
       server just transferred away) is removed — deleting the account
       means leaving every server.
    3. Every friendship/request/block row involving `user`, in either
       direction, is removed.
    4. `user` itself is anonymized (`User.deletion_changeset/1`) —
       message/DM authorship, reactions, and DM room history are
       deliberately left untouched (see `display_username/1`).

  Broadcasts (`server_deleted`, `member_left`, `server_updated` for a
  transferred owner, `friend_removed`) only fire *after* the transaction
  commits, never mid-transaction — a side effect like a broadcast can't be
  rolled back, so nothing goes out until we know the whole thing actually
  happened.

  Returns `{:ok, anonymized_user}`, `{:error, :invalid_current_password}`,
  or `{:error, reason}` (changeset or other reason from a failed step).
  """
  def delete_account(%User{} = user, current_password) do
    if verify_password?(user, current_password) do
      user
      |> build_deletion_multi()
      |> Repo.transaction()
      |> case do
        {:ok, result} ->
          broadcast_deletion_effects(result)
          {:ok, result.anonymized_user}

        {:error, _failed_step, reason, _changes} ->
          {:error, reason}
      end
    else
      {:error, :invalid_current_password}
    end
  end

  defp build_deletion_multi(user) do
    Multi.new()
    |> Multi.run(:owned_servers, &fetch_owned_servers_step(&1, &2, user.id))
    |> Multi.run(:server_outcomes, &resolve_server_outcomes_step/2)
    |> Multi.run(:remaining_memberships, &fetch_remaining_memberships_step(&1, &2, user.id))
    |> Multi.run(:remove_memberships, &remove_memberships_step/2)
    |> Multi.run(:friendship_rows, &fetch_friendship_rows_step(&1, &2, user.id))
    |> Multi.run(:remove_friendships, &remove_friendships_step/2)
    |> Multi.update(:anonymized_user, User.deletion_changeset(user))
  end

  defp fetch_owned_servers_step(repo, _changes, user_id) do
    {:ok, fetch_owned_servers(repo, user_id)}
  end

  defp resolve_server_outcomes_step(repo, %{owned_servers: owned}) do
    resolve_server_outcomes(repo, owned)
  end

  defp fetch_remaining_memberships_step(repo, _changes, user_id) do
    {:ok, ServerMember |> where([m], m.user_id == ^user_id) |> repo.all()}
  end

  defp remove_memberships_step(repo, %{remaining_memberships: rows}) do
    ids = Enum.map(rows, & &1.id)
    {_count, _} = ServerMember |> where([m], m.id in ^ids) |> repo.delete_all()
    {:ok, rows |> Enum.map(& &1.server_id) |> Enum.uniq()}
  end

  defp fetch_friendship_rows_step(repo, _changes, user_id) do
    rows =
      Friendship
      |> where([f], f.user_id == ^user_id or f.friend_id == ^user_id)
      |> repo.all()

    {:ok, rows}
  end

  defp remove_friendships_step(repo, %{friendship_rows: rows}) do
    ids = Enum.map(rows, & &1.id)
    {_count, _} = Friendship |> where([f], f.id in ^ids) |> repo.delete_all()
    {:ok, rows}
  end

  defp fetch_owned_servers(repo, user_id) do
    Server
    |> where([s], s.owner_id == ^user_id)
    |> repo.all()
    |> Enum.map(fn server ->
      other_members =
        ServerMember
        |> where([m], m.server_id == ^server.id and m.user_id != ^user_id)
        |> order_by([m], asc: m.inserted_at)
        |> repo.all()

      {server, other_members}
    end)
  end

  defp resolve_server_outcomes(repo, owned) do
    Enum.reduce_while(owned, {:ok, []}, fn {server, other_members}, {:ok, acc} ->
      case resolve_server_outcome(repo, server, other_members) do
        {:ok, outcome} -> {:cont, {:ok, [outcome | acc]}}
        {:error, _reason} = error -> {:halt, error}
      end
    end)
    |> case do
      {:ok, outcomes} -> {:ok, Enum.reverse(outcomes)}
      error -> error
    end
  end

  defp resolve_server_outcome(repo, server, []) do
    case repo.delete(server) do
      {:ok, deleted} -> {:ok, {:deleted, deleted}}
      {:error, _reason} = error -> error
    end
  end

  defp resolve_server_outcome(repo, server, [new_owner_member | _rest] = members) do
    with {:ok, updated_server} <-
           server |> Server.changeset(%{owner_id: new_owner_member.user_id}) |> repo.update(),
         {:ok, _updated_member} <-
           new_owner_member |> ServerMember.changeset(%{role: "owner"}) |> repo.update() do
      {:ok, {:transferred, updated_server, Enum.map(members, & &1.user_id)}}
    end
  end

  defp broadcast_deletion_effects(result) do
    Enum.each(result.server_outcomes, &broadcast_server_outcome/1)
    Enum.each(result.remove_memberships, &broadcast_member_left(&1, result))
    Enum.each(result.friendship_rows, &broadcast_friend_removed(&1, result))
  end

  defp broadcast_server_outcome({:deleted, server}) do
    BackendWeb.Endpoint.broadcast("server:#{server.id}", "server_deleted", %{
      server_id: server.id
    })
  end

  defp broadcast_server_outcome({:transferred, server, _member_ids}) do
    BackendWeb.Endpoint.broadcast("server:#{server.id}", "server_updated", %{
      server_id: server.id,
      name: server.name,
      owner_id: server.owner_id
    })
  end

  # remaining_memberships' server_ids include both plain-membership servers
  # and any just-transferred server's now-stale old-owner row — "member_left"
  # is the right event for both, the deleting user genuinely left either way.
  # A server that was outright deleted (no other members) never appears here:
  # its membership rows were already gone via the DB cascade by the time the
  # :remaining_memberships step (which runs after :server_outcomes) queried.
  defp broadcast_member_left(server_id, _result) do
    BackendWeb.Endpoint.broadcast("server:#{server_id}", "member_left", %{
      server_id: server_id
    })
  end

  defp broadcast_friend_removed(%Friendship{user_id: uid, friend_id: fid, id: id}, result) do
    other_id = if uid == result.anonymized_user.id, do: fid, else: uid
    BackendWeb.Endpoint.broadcast("user:#{other_id}", "friend_removed", %{id: id})
  end
end
