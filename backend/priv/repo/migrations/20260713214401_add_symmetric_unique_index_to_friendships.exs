defmodule Backend.Repo.Migrations.AddSymmetricUniqueIndexToFriendships do
  use Ecto.Migration

  @moduledoc """
  The existing `unique_index(:friendships, [:user_id, :friend_id])` is
  directional — it stops the exact same (user_id, friend_id) pair from being
  inserted twice, but does nothing to stop (A, B) and (B, A) from coexisting
  as two separate rows. That's exactly what happens if A and B send each
  other a friend request at (near enough) the same instant: both requests
  can read "no existing friendship" before either commits, so both insert
  their own directional row instead of the second one recognizing the first
  and auto-accepting (see `Backend.Friends.send_request/2`).

  A trigger that physically swaps user_id/friend_id into sorted order
  (the more obvious-looking fix) isn't safe here, unlike the analogous
  dm_rooms case — user_id/friend_id carry real meaning (who *sent* the
  request, used for the "incoming"/"outgoing" direction and for
  authorization elsewhere), so silently reordering them out from under the
  application would corrupt that meaning. A unique expression index instead
  enforces the symmetric constraint at the database level without touching
  either column's actual value: LEAST/GREATEST normalize the *comparison*
  only, so (A, B) and (B, A) collide on the same index entry while each
  row's own user_id/friend_id stay exactly as inserted.
  """

  def change do
    create unique_index(
             :friendships,
             ["LEAST(user_id, friend_id)", "GREATEST(user_id, friend_id)"],
             name: :friendships_symmetric_pair_index
           )
  end
end
