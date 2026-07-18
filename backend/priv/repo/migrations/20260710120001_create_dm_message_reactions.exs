defmodule Backend.Repo.Migrations.CreateDmMessageReactions do
  use Ecto.Migration

  def change do
    create table(:dm_message_reactions, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :dm_message_id, references(:dm_messages, type: :binary_id, on_delete: :delete_all),
        null: false

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :emoji, :string, null: false

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create index(:dm_message_reactions, [:dm_message_id])
    create unique_index(:dm_message_reactions, [:dm_message_id, :user_id, :emoji])
  end
end
