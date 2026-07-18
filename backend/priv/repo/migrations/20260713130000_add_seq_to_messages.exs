defmodule Backend.Repo.Migrations.AddSeqToMessages do
  use Ecto.Migration

  @moduledoc """
  Cursor pagination ordered by `inserted_at` — even at microsecond
  precision — can still tie two messages sent in rapid succession, since
  the OS/VM clock's actual resolution isn't guaranteed to be that fine
  (observed in practice on this codebase's Windows dev environment). Ties
  then fall back to the (random UUID) id, which doesn't track send order
  at all. A DB-assigned monotonic sequence removes the ambiguity
  entirely — `nextval()` is strictly increasing and assigned atomically
  per insert, independent of wall-clock resolution.
  """

  def change do
    alter table(:messages) do
      add :seq, :bigserial
    end

    create index(:messages, [:channel_id, :seq])

    alter table(:dm_messages) do
      add :seq, :bigserial
    end

    create index(:dm_messages, [:dm_room_id, :seq])
  end
end
