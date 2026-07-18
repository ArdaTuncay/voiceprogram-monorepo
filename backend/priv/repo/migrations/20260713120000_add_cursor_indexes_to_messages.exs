defmodule Backend.Repo.Migrations.AddCursorIndexesToMessages do
  use Ecto.Migration

  def change do
    drop index(:messages, [:channel_id])
    create index(:messages, [:channel_id, :inserted_at, :id])

    drop index(:dm_messages, [:dm_room_id])
    create index(:dm_messages, [:dm_room_id, :inserted_at, :id])
  end
end
