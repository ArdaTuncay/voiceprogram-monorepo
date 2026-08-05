defmodule Backend.Repo.Migrations.AddDeletedAtToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :deleted_at, :utc_datetime
    end

    alter table(:dm_messages) do
      add :deleted_at, :utc_datetime
    end
  end
end
