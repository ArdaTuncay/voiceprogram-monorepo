defmodule Backend.Repo.Migrations.WidenTokenValidFromPrecision do
  use Ecto.Migration

  @moduledoc """
  Second-level precision was too coarse: a token signed in the same
  wall-clock second as a `POST /api/users/logout_all` call (easily hit by
  an automated test, and in principle by a fast client too) compared equal
  rather than older, and `Backend.Accounts.authenticate_token/1` treats
  "not older" as still valid — so the token would keep working. Widening to
  microseconds makes that tie practically impossible.
  """

  def change do
    alter table(:users) do
      modify :token_valid_from, :utc_datetime_usec, from: :utc_datetime
    end
  end
end
