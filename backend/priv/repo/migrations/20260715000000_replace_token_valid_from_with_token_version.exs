defmodule Backend.Repo.Migrations.ReplaceTokenValidFromWithTokenVersion do
  use Ecto.Migration

  @moduledoc """
  `token_valid_from` compared wall-clock timestamps (`signed_at` on the
  token vs. this column) to decide whether a token survived a
  `logout_all`/password-change revocation — the same class of bug already
  hit `messages.inserted_at` (see `20260713130000_add_seq_to_messages`):
  this machine's OS clock only ticks every ~15ms, far coarser than the
  microsecond precision the comparison assumed, so two `DateTime.utc_now()`
  reads close together (e.g. a token signed just before a revocation, with
  only a few ms of real gap) can compare *equal* instead of *older* —
  and `Backend.Accounts.authenticate_token/1` treated "not older" as
  still valid, so an actually-revoked token could keep working. Widening
  precision further doesn't fix this: any wall-clock comparison is racy
  as long as clock resolution can exceed the real gap between events.

  `token_version` sidesteps the clock entirely: it's a plain integer,
  bumped by exactly 1 on every event that must invalidate prior tokens
  (registration, revoke_all_tokens). A token is valid iff its embedded
  version equals the user's *current* row value — comparing Postgres's
  own transactional read consistency instead of two independently-read
  timestamps, so there's no tie to race.
  """

  def change do
    alter table(:users) do
      remove :token_valid_from, :utc_datetime_usec
      add :token_version, :integer, null: false, default: 0
    end
  end
end
