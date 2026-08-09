defmodule Backend.Repo.Migrations.CreateDmRoomReads do
  use Ecto.Migration

  def change do
    create table(:dm_room_reads, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      add :dm_room_id, references(:dm_rooms, type: :binary_id, on_delete: :delete_all),
        null: false

      add :last_read_seq, :integer, default: 0, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:dm_room_reads, [:user_id, :dm_room_id])
  end
end
