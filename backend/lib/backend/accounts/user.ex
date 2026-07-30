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
