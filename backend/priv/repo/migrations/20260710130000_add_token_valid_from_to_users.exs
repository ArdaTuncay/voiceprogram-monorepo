defmodule Backend.Repo.Migrations.AddTokenValidFromToUsers do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :token_valid_from, :utc_datetime, null: false, default: fragment("now()")
    end
  end
end
