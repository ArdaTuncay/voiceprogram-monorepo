defmodule Backend.Repo.Migrations.CreateServerMembers do
  use Ecto.Migration

  def change do
    create table(:server_members, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :server_id, references(:servers, type: :binary_id, on_delete: :delete_all), null: false
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :role, :string, null: false, default: "member"

      timestamps(type: :utc_datetime)
    end

    create unique_index(:server_members, [:server_id, :user_id])
    create index(:server_members, [:user_id])
  end
end
