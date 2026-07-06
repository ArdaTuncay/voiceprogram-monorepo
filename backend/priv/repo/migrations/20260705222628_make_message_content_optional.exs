defmodule Backend.Repo.Migrations.MakeMessageContentOptional do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      modify :content, :text, null: true
    end
  end
end
