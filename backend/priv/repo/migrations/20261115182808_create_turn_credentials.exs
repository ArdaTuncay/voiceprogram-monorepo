defmodule Backend.Repo.Migrations.CreateTurnCredentials do
  @moduledoc """
  One current Metered TURN credential per user (see `Backend.Turn`). Kept
  in the database rather than in memory because a freshly created Metered
  credential needs up to 2 minutes to work everywhere: a cache lost on
  every deploy/restart would hand everyone brand-new, not-yet-usable
  credentials right after each deploy.
  """
  use Ecto.Migration

  def change do
    create table(:turn_credentials, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :metered_username, :string, null: false
      add :ice_servers, {:array, :map}, null: false
      add :expires_at, :utc_datetime, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:turn_credentials, [:user_id])
  end
end
