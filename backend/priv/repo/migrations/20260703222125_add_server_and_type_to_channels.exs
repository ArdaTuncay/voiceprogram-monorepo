defmodule Backend.Repo.Migrations.AddServerAndTypeToChannels do
  use Ecto.Migration

  def change do
    alter table(:channels) do
      add :server_id, references(:servers, type: :binary_id, on_delete: :delete_all)
      add :type, :string, null: false, default: "text"
    end

    create index(:channels, [:server_id])

    # Channel names used to be globally unique; now they only need to be
    # unique within a server (two servers can each have a "genel" channel).
    drop_if_exists index(:channels, [:name])
    create unique_index(:channels, [:server_id, :name])
  end
end
