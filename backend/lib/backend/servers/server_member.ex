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

    timestamps(type: :utc_datetime)
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
