defmodule Backend.DirectMessages.DmRoom do
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "dm_rooms" do
    belongs_to :user_one, User
    belongs_to :user_two, User

    timestamps(type: :utc_datetime)
  end

  @doc """
  `user_one_id`/`user_two_id` must already be in canonical (sorted) order —
  see `Backend.DirectMessages.canonical_pair/2` — so the same two people
  always map to the same row regardless of who opened the DM.
  """
  def changeset(room, attrs) do
    room
    |> cast(attrs, [:user_one_id, :user_two_id])
    |> validate_required([:user_one_id, :user_two_id])
    |> unique_constraint([:user_one_id, :user_two_id])
    |> foreign_key_constraint(:user_one_id)
    |> foreign_key_constraint(:user_two_id)
  end
end
