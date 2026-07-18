defmodule Backend.Chat.Channel do
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Servers.Server

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "channels" do
    field :name, :string
    field :type, :string, default: "text"
    field :position, :integer, default: 0
    belongs_to :server, Server
    belongs_to :parent, __MODULE__
    has_many :sub_channels, __MODULE__, foreign_key: :parent_id

    timestamps(type: :utc_datetime)
  end

  def changeset(channel, attrs) do
    channel
    |> cast(attrs, [:name, :type, :server_id, :parent_id, :position])
    |> validate_required([:name, :type, :server_id])
    |> validate_inclusion(:type, ["text", "voice", "category"])
    |> validate_length(:name, min: 1, max: 50)
    |> validate_no_parent_for_category()
    |> unique_constraint([:server_id, :name])
    |> foreign_key_constraint(:server_id)
    |> foreign_key_constraint(:parent_id)
  end

  @doc "Changeset for bulk parent/position updates — see Backend.Servers.update_channel_positions/2."
  def position_changeset(channel, attrs) do
    channel
    |> cast(attrs, [:parent_id, :position])
    |> validate_no_parent_for_category()
    |> foreign_key_constraint(:parent_id)
  end

  # Categories group other channels, one level deep — a category can't
  # itself be nested inside another category.
  defp validate_no_parent_for_category(changeset) do
    type = get_field(changeset, :type)
    parent_id = get_field(changeset, :parent_id)

    if type == "category" and not is_nil(parent_id) do
      add_error(changeset, :parent_id, "categories cannot be nested")
    else
      changeset
    end
  end
end
