defmodule Backend.Repo.Migrations.AddChannelIdToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :channel_id, references(:channels, type: :binary_id, on_delete: :delete_all)
    end

    create index(:messages, [:channel_id])
  end
end
