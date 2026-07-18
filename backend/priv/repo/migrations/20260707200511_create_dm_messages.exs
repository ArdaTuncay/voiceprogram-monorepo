defmodule Backend.Repo.Migrations.CreateDmMessages do
  use Ecto.Migration

  def change do
    create table(:dm_messages, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :dm_room_id, references(:dm_rooms, type: :binary_id, on_delete: :delete_all),
        null: false

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :content, :text
      add :file_url, :string
      add :file_type, :string

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create index(:dm_messages, [:dm_room_id])
  end
end
