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
