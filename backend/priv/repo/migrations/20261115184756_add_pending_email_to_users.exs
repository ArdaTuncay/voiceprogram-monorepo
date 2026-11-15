defmodule Backend.Repo.Migrations.AddPendingEmailToUsers do
  @moduledoc """
  An email change waiting for confirmation (see
  `Backend.Accounts.request_email_change/2`): the requested address, a
  SHA-256 hash of the token mailed to it, and when it was sent.
  """
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :pending_email, :string
      add :pending_email_token_hash, :string
      add :pending_email_sent_at, :utc_datetime
    end

    create unique_index(:users, [:pending_email_token_hash],
             where: "pending_email_token_hash IS NOT NULL"
           )
  end
end
