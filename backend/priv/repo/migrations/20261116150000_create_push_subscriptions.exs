defmodule Backend.Repo.Migrations.CreatePushSubscriptions do
  @moduledoc """
  One row per browser that asked for notifications while Zircle is closed
  (see `Backend.Push`). Tied to the session that subscribed, so signing that
  device out — or the session expiring — stops its notifications too.
  """
  use Ecto.Migration

  def change do
    create table(:push_subscriptions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      add :session_id,
          references(:user_sessions, type: :binary_id, on_delete: :delete_all)

      add :endpoint, :text, null: false
      add :p256dh, :string, null: false
      add :auth, :string, null: false
      add :locale, :string, size: 8, null: false, default: "tr"

      timestamps(type: :utc_datetime)
    end

    create unique_index(:push_subscriptions, [:endpoint])
    create index(:push_subscriptions, [:user_id])
    create index(:push_subscriptions, [:session_id])
  end
end
