defmodule Backend.Servers.Invite do
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Servers.Server

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "server_invites" do
    field :code, :string
    field :expires_at, :utc_datetime
    field :max_uses, :integer
    field :uses_count, :integer, default: 0

    belongs_to :server, Server
    belongs_to :inviter, User

    timestamps(type: :utc_datetime)
  end

  def changeset(invite, attrs) do
    invite
    |> cast(attrs, [:code, :server_id, :inviter_id, :expires_at, :max_uses, :uses_count])
    |> validate_required([:code, :server_id, :inviter_id])
    |> validate_number(:max_uses, greater_than: 0)
    |> unique_constraint(:code)
    |> foreign_key_constraint(:server_id)
    |> foreign_key_constraint(:inviter_id)
  end
end
