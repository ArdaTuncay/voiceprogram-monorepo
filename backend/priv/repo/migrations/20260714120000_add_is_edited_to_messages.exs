defmodule Backend.Repo.Migrations.AddIsEditedToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :is_edited, :boolean, default: false, null: false
    end

    alter table(:dm_messages) do
      add :is_edited, :boolean, default: false, null: false
    end
  end
end
