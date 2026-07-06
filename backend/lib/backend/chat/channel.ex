defmodule Backend.Chat.Channel do
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Servers.Server

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "channels" do
    field :name, :string
    field :type, :string, default: "text"
    belongs_to :server, Server

    timestamps(type: :utc_datetime)
  end

  def changeset(channel, attrs) do
    channel
    |> cast(attrs, [:name, :type, :server_id])
    |> validate_required([:name, :type, :server_id])
    |> validate_inclusion(:type, ["text", "voice"])
    |> validate_length(:name, min: 1, max: 50)
    |> unique_constraint([:server_id, :name])
    |> foreign_key_constraint(:server_id)
  end
end
