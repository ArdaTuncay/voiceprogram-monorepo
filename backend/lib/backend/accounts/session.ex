defmodule Backend.Accounts.Session do
  @moduledoc """
  A signed-in device: created at sign-in, kept by token renewal, deleted
  when that device signs out, is signed out from another one, or every
  session ends (password change/reset, "sign out everywhere", account
  deletion). Session tokens carry its id — see `Backend.Accounts`.

  Only what the owner needs to recognise a device is kept: the browser's
  user agent, the IP it signed in or was last seen from, and when.
  """
  use Ecto.Schema

  alias Backend.Accounts.User

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "user_sessions" do
    belongs_to :user, User
    field :user_agent, :string
    field :ip, :string
    field :last_seen_at, :utc_datetime

    timestamps(type: :utc_datetime, updated_at: false)
  end
end
