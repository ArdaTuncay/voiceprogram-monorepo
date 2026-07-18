defmodule Backend.Repo.Migrations.DropUnusedCursorIndexes do
  use Ecto.Migration

  @moduledoc """
  Cursor pagination (`Backend.Chat.list_messages/2` and
  `Backend.DirectMessages.list_messages/2`) now orders by the `seq`
  bigserial column instead of `inserted_at`/`id` — see
  20260713130000_add_seq_to_messages.exs, which added the
  `(channel_id, seq)` / `(dm_room_id, seq)` indexes those queries actually
  use. The `(channel_id, inserted_at, id)` / `(dm_room_id, inserted_at,
  id)` composite indexes added just before that, in
  20260713120000_add_cursor_indexes_to_messages.exs, were never dropped —
  no query has touched them since, but every message/dm_message insert has
  kept paying to maintain them.
  """

  def change do
    drop index(:messages, [:channel_id, :inserted_at, :id])
    drop index(:dm_messages, [:dm_room_id, :inserted_at, :id])
  end
end
