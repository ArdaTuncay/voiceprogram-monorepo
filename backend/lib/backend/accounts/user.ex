defmodule Backend.Accounts.User do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "users" do
    field :username, :string
    field :email, :string
    field :password, :string, virtual: true, redact: true
    field :password_hash, :string, redact: true
    field :status, :string, default: "offline"
    field :token_version, :integer, default: 0
    field :friend_request_privacy, :string, default: "everyone"
    field :deleted_at, :utc_datetime
    field :email_verified, :boolean, default: false
    field :email_verification_token, :string
    field :email_verification_sent_at, :utc_datetime

    timestamps(type: :utc_datetime)
  end

  def registration_changeset(user, attrs) do
    user
    |> cast(attrs, [:username, :email, :password])
    |> validate_required([:username, :email, :password])
    |> validate_length(:username, min: 3, max: 30)
    |> validate_format(:username, ~r/^[a-zA-Z0-9_]+$/,
      message: "only letters, numbers and underscores allowed"
    )
    |> validate_format(:email, ~r/^[^\s]+@[^\s]+$/, message: "must be a valid email")
    |> validate_length(:password, min: 8, message: "must be at least 8 characters")
    |> unique_constraint(:email)
    |> unique_constraint(:username)
    |> hash_password()
  end

  @doc "Used by Backend.Accounts.update_username/2 — same format/length rules as registration."
  def username_changeset(user, attrs) do
    user
    |> cast(attrs, [:username])
    |> validate_required([:username])
    |> validate_length(:username, min: 3, max: 30)
    |> validate_format(:username, ~r/^[a-zA-Z0-9_]+$/,
      message: "only letters, numbers and underscores allowed"
    )
    |> unique_constraint(:username)
  end

  @doc """
  Used by Backend.Accounts.update_email/2 — no confirmation link, this
  takes effect immediately (see PROJECT_ARCHITECTURE.md's note on why:
  no mail provider is wired up yet, and this project doesn't have a real
  user base to protect from a mistyped/hijacked address).
  """
  def email_changeset(user, attrs) do
    user
    |> cast(attrs, [:email])
    |> validate_required([:email])
    |> validate_format(:email, ~r/^[^\s]+@[^\s]+$/, message: "must be a valid email")
    |> unique_constraint(:email)
  end

  @doc """
  Used by Backend.Accounts.update_password/3, after that function has
  already verified the caller's current password. Goes through the same
  `hash_password/1` hook as registration, so a successful update also
  bumps `token_version` — every token issued before this change stops
  authenticating (see `Backend.Accounts.authenticate_token/1`), the same
  effect `revoke_all_tokens/1` produces, without a second write.
  """
  def password_changeset(user, attrs) do
    user
    |> cast(attrs, [:password])
    |> validate_required([:password])
    |> validate_length(:password, min: 8, message: "must be at least 8 characters")
    |> hash_password()
  end

  @doc """
  Used by Backend.Accounts.update_friend_request_privacy/2 — "everyone"
  (default) or "nobody", checked by Backend.Friends.send_request/2 before
  a request is even created. Deliberately only these two options, no
  "friends of friends" tier — see PROJECT_ARCHITECTURE.md's note on why.
  """
  def friend_request_privacy_changeset(user, attrs) do
    user
    |> cast(attrs, [:friend_request_privacy])
    |> validate_required([:friend_request_privacy])
    |> validate_inclusion(:friend_request_privacy, ["everyone", "nobody"])
  end

  @doc """
  Used by Backend.Accounts.delete_account/2 — anonymizes username/email/
  password_hash to random, unguessable values, marks `deleted_at`, and
  bumps `token_version` (same effect as password_changeset/2's, done
  directly here rather than through hash_password/1 since there's no
  plaintext "password" to run through Pbkdf2, just a random hash).
  Message/DM authorship, reactions, and DM rooms are deliberately left
  alone by this changeset — see PROJECT_ARCHITECTURE.md's account
  deletion section for what happens to them and why.
  """
  def deletion_changeset(user) do
    suffix = :crypto.strong_rand_bytes(6) |> Base.encode16(case: :lower)

    user
    |> change(
      username: "deleted_user_" <> suffix,
      email: "deleted-" <> suffix <> "@deleted.invalid",
      password_hash: Pbkdf2.hash_pwd_salt(:crypto.strong_rand_bytes(32) |> Base.encode64()),
      status: "offline",
      deleted_at: DateTime.truncate(DateTime.utc_now(), :second),
      token_version: user.token_version + 1
    )
    |> unique_constraint(:username)
    |> unique_constraint(:email)
  end

  @doc "True if this user has deleted their account (see deletion_changeset/1)."
  def deleted?(%__MODULE__{deleted_at: nil}), do: false
  def deleted?(%__MODULE__{}), do: true

  # Runs whenever a password is being set (registration) or, in the future,
  # changed — bumping token_version here means both cases are covered by
  # this one hook, and any statically-issued token signed against an older
  # version is rejected by Backend.Accounts.authenticate_token/1 even if it
  # hasn't hit its max_age expiry yet.
  defp hash_password(%Ecto.Changeset{valid?: true, changes: %{password: password}} = changeset) do
    changeset
    |> put_change(:password_hash, Pbkdf2.hash_pwd_salt(password))
    |> put_change(:token_version, get_field(changeset, :token_version) + 1)
  end

  defp hash_password(changeset), do: changeset
end
