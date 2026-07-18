defmodule Backend.Repo.Migrations.CreateDmRooms do
  use Ecto.Migration

  def change do
    create table(:dm_rooms, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_one_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :user_two_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:dm_rooms, [:user_one_id, :user_two_id])
    create index(:dm_rooms, [:user_two_id])
  end
end
