defmodule Backend.Repo.Migrations.WidenMessageTimestampsPrecision do
  use Ecto.Migration

  @moduledoc """
  Second-level precision is too coarse for cursor-based pagination: two
  messages sent in the same wall-clock second compare equal on
  `inserted_at`, so `Chat.list_messages/2` and
  `DirectMessages.list_messages/2` fall back to ordering those messages by
  their (random UUID) id — which doesn't track send order at all. Widening
  to microseconds makes that tie practically impossible, mirroring the same
  fix already applied to `users.token_valid_from`.
  """

  def change do
    alter table(:messages) do
      modify :inserted_at, :utc_datetime_usec, from: :utc_datetime
    end

    alter table(:dm_messages) do
      modify :inserted_at, :utc_datetime_usec, from: :utc_datetime
    end
  end
end
