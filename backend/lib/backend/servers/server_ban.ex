defmodule Backend.Servers.ServerBan do
  @moduledoc """
  A user barred from a server — see `Backend.Servers.ban_user/4`.
  """
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Servers.Server

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "server_bans" do
    belongs_to :server, Server
    belongs_to :user, User
    belongs_to :banned_by, User
    field :reason, :string

    timestamps(type: :utc_datetime)
  end

  def changeset(ban, attrs) do
    ban
    |> cast(attrs, [:server_id, :user_id, :banned_by_id, :reason])
    |> validate_required([:server_id, :user_id])
    |> update_change(:reason, &String.trim/1)
    |> validate_length(:reason, max: 200)
    |> foreign_key_constraint(:server_id)
    |> foreign_key_constraint(:user_id)
    |> unique_constraint([:server_id, :user_id])
  end
end
