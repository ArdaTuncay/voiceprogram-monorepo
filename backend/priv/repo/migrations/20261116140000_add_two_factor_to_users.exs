defmodule Backend.Repo.Migrations.AddTwoFactorToUsers do
  @moduledoc """
  Two-factor sign-in (see `Backend.Accounts.TwoFactor`): the TOTP secret
  (encrypted), when it was turned on, the time step of the last code used
  (so a code can't be replayed) and SHA-256 hashes of the unused recovery
  codes. All null/empty for accounts without two-factor.
  """
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :totp_secret, :text
      add :totp_enabled_at, :utc_datetime
      add :totp_last_used_at, :utc_datetime
      add :totp_recovery_hashes, {:array, :string}, null: false, default: []
    end
  end
end
