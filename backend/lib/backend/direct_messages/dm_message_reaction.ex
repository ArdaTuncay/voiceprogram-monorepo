defmodule Backend.DirectMessages.DmMessageReaction do
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.DirectMessages.DmMessage

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "dm_message_reactions" do
    field :emoji, :string
    belongs_to :user, User
    belongs_to :dm_message, DmMessage

    timestamps(type: :utc_datetime, updated_at: false)
  end

  def changeset(reaction, attrs) do
    reaction
    |> cast(attrs, [:emoji, :user_id, :dm_message_id])
    |> validate_required([:emoji, :user_id, :dm_message_id])
    |> validate_length(:emoji, min: 1, max: 32)
    |> foreign_key_constraint(:user_id)
    |> foreign_key_constraint(:dm_message_id)
    |> unique_constraint([:dm_message_id, :user_id, :emoji])
  end
end
