defmodule Backend.Repo.Migrations.AddEmailVerificationToUsers do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :email_verified, :boolean, null: false, default: false
      add :email_verification_token, :string
      add :email_verification_sent_at, :utc_datetime
    end

    create unique_index(:users, [:email_verification_token],
             where: "email_verification_token IS NOT NULL"
           )
  end
end
