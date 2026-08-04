defmodule Backend.Repo.Migrations.WidenServerMembersTimestampsPrecision do
  use Ecto.Migration

  @moduledoc """
  Second-level precision is too coarse for `Backend.Accounts.delete_account/2`'s
  ownership-transfer rule ("oldest other member becomes the new owner"): two
  members who joined within the same wall-clock second compare equal on
  `inserted_at`, making `ORDER BY inserted_at ASC` pick between them
  arbitrarily instead of by actual join order. Widening to microseconds
  makes that tie practically impossible — same fix already applied to
  `messages`/`dm_messages` and `users.token_valid_from` (see those
  migrations) for the same class of bug.
  """

  def change do
    alter table(:server_members) do
      modify :inserted_at, :utc_datetime_usec, from: :utc_datetime
    end
  end
end
