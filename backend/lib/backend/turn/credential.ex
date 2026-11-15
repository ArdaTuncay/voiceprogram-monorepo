defmodule Backend.Turn.Credential do
  @moduledoc """
  A user's current Metered TURN credential: the ICE server entries (with
  username/password) handed to their browser, and when Metered stops
  accepting them. See `Backend.Turn` for how it's issued and rotated.
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "turn_credentials" do
    belongs_to :user, Backend.Accounts.User
    field :metered_username, :string
    field :ice_servers, {:array, :map}
    field :expires_at, :utc_datetime

    timestamps(type: :utc_datetime)
  end
end
