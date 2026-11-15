defmodule Backend.Repo.Migrations.AddPasswordResetToUsers do
  @moduledoc """
  Password reset (see `Backend.Accounts.request_password_reset/1`). Only a
  SHA-256 hash of the emailed token is stored — a database leak or backup
  can't be turned into working reset links.
  """
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :password_reset_token_hash, :string
      add :password_reset_sent_at, :utc_datetime
    end

    create unique_index(:users, [:password_reset_token_hash],
             where: "password_reset_token_hash IS NOT NULL"
           )
  end
end
