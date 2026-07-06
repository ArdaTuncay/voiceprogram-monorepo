defmodule Backend.Repo.Migrations.CreateServerInvites do
  use Ecto.Migration

  def change do
    create table(:server_invites, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :code, :string, null: false
      add :server_id, references(:servers, type: :binary_id, on_delete: :delete_all), null: false
      add :inviter_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :expires_at, :utc_datetime
      add :max_uses, :integer
      add :uses_count, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:server_invites, [:code])
    create index(:server_invites, [:server_id])
  end
end
