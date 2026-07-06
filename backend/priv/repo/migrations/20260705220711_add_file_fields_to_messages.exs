defmodule Backend.Repo.Migrations.AddFileFieldsToMessages do
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :file_url, :string
      add :file_type, :string
    end
  end
end
