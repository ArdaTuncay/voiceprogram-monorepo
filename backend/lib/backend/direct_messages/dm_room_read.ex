defmodule Backend.DirectMessages.DmRoomRead do
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.DirectMessages.DmRoom

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "dm_room_reads" do
    field :last_read_seq, :integer, default: 0
    belongs_to :user, User
    belongs_to :dm_room, DmRoom

    timestamps(type: :utc_datetime)
  end

  def changeset(dm_room_read, attrs) do
    dm_room_read
    |> cast(attrs, [:user_id, :dm_room_id, :last_read_seq])
    |> validate_required([:user_id, :dm_room_id, :last_read_seq])
    |> unique_constraint([:user_id, :dm_room_id])
    |> foreign_key_constraint(:user_id)
    |> foreign_key_constraint(:dm_room_id)
  end
end
