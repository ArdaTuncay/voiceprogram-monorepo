defmodule Backend.Servers.Server do
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "servers" do
    field :name, :string
    field :icon_url, :string
    # The viewer's own role, filled by Backend.Servers.list_servers_for_user/1.
    field :my_role, :string, virtual: true
    belongs_to :owner, User

    timestamps(type: :utc_datetime)
  end

  def changeset(server, attrs) do
    server
    |> cast(attrs, [:name, :owner_id])
    |> validate_required([:name, :owner_id])
    |> validate_length(:name, min: 1, max: 50)
    |> foreign_key_constraint(:owner_id)
  end

  @doc "Sets or clears (nil) the server icon — an image from our own upload storage only."
  def icon_changeset(server, attrs) do
    server
    |> cast(attrs, [:icon_url], empty_values: [nil, ""])
    |> Backend.Uploads.validate_own_image(:icon_url)
  end

  @doc "Renames a server. Deliberately excludes :owner_id — ownership isn't transferable via this changeset."
  def rename_changeset(server, attrs) do
    server
    |> cast(attrs, [:name])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 50)
  end
end
