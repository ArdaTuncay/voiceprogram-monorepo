defmodule Backend.Friends.Friendship do
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "friendships" do
    field :status, :string, default: "pending"
    belongs_to :user, User
    belongs_to :friend, User

    timestamps(type: :utc_datetime)
  end

  def changeset(friendship, attrs) do
    friendship
    |> cast(attrs, [:user_id, :friend_id, :status])
    |> validate_required([:user_id, :friend_id, :status])
    |> validate_inclusion(:status, ["pending", "accepted", "blocked"])
    |> validate_not_self_friend()
    |> unique_constraint([:user_id, :friend_id])
    # Catches the *other* direction too (see the migration) — attached to
    # :user_id rather than the default :friend_id so Backend.Friends can
    # tell this apart from the plain constraint above in changeset.errors.
    |> unique_constraint(:user_id,
      name: :friendships_symmetric_pair_index,
      message: "already have a pending or accepted friendship with this user"
    )
    |> foreign_key_constraint(:user_id)
    |> foreign_key_constraint(:friend_id)
  end

  defp validate_not_self_friend(changeset) do
    user_id = get_field(changeset, :user_id)
    friend_id = get_field(changeset, :friend_id)

    if user_id && friend_id && user_id == friend_id do
      add_error(changeset, :friend_id, "cannot friend yourself")
    else
      changeset
    end
  end
end
