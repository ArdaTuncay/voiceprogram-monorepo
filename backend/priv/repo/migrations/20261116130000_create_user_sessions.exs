defmodule Backend.Repo.Migrations.CreateUserSessions do
  @moduledoc """
  One row per signed-in device (see `Backend.Accounts.Session`): what the
  account's "active sessions" list shows, and what lets one of them be
  signed out on its own. Session tokens carry the row's id; deleting the
  row ends that session.
  """
  use Ecto.Migration

  def change do
    create table(:user_sessions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :user_agent, :string, size: 512
      add :ip, :string, size: 45
      add :last_seen_at, :utc_datetime, null: false

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create index(:user_sessions, [:user_id, :last_seen_at])
  end
end
