defmodule Backend.Accounts do
  @moduledoc """
  User registration, authentication (token-based, via `Phoenix.Token`), and
  online/offline status.
  """

  import Ecto.Query, only: [from: 2]

  alias Backend.Accounts.User
  alias Backend.Repo

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
end
