defmodule Backend.Servers.ServerMember do
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Servers.Server

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "server_members" do
    field :role, :string, default: "member"
    belongs_to :server, Server
    belongs_to :user, User

    # inserted_at is usec-precision (not the plain :utc_datetime most other
    # schemas use) because Backend.Accounts.delete_account/2 orders by it to
    # pick "the oldest other member" for ownership transfer — see the
    # widen_server_members_timestamps_precision migration.
    timestamps(type: :utc_datetime_usec)
  end

  def changeset(member, attrs) do
    member
    |> cast(attrs, [:server_id, :user_id, :role])
    |> validate_required([:server_id, :user_id, :role])
    |> validate_inclusion(:role, ["owner", "member"])
    |> unique_constraint([:server_id, :user_id])
    |> foreign_key_constraint(:server_id)
    |> foreign_key_constraint(:user_id)
  end
end
