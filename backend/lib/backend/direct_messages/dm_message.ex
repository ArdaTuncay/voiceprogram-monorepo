defmodule Backend.DirectMessages.DmMessage do
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.DirectMessages.DmRoom

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "dm_messages" do
    field :content, :string
    field :file_url, :string
    field :file_type, :string
    field :is_edited, :boolean, default: false
    field :reactions, {:array, :map}, virtual: true, default: []
    # DB-assigned monotonic sequence — the authoritative send order for
    # cursor pagination (see Backend.DirectMessages.list_messages/2). Never
    # client-settable, so it's not part of the changeset's cast fields.
    field :seq, :integer, read_after_writes: true
    belongs_to :user, User
    belongs_to :dm_room, DmRoom

    timestamps(type: :utc_datetime_usec, updated_at: false)
  end

  def changeset(message, attrs) do
    message
    |> cast(attrs, [:content, :file_url, :file_type, :user_id, :dm_room_id])
    |> validate_required([:user_id, :dm_room_id])
    |> validate_length(:content, max: 4000)
    |> validate_content_or_file()
    |> foreign_key_constraint(:user_id)
    |> foreign_key_constraint(:dm_room_id)
  end

  @doc "Changeset for editing an existing message's content — always marks it as edited."
  def edit_changeset(message, attrs) do
    message
    |> cast(attrs, [:content])
    |> validate_length(:content, max: 4000)
    |> validate_content_or_file()
    |> put_change(:is_edited, true)
  end

  # A message needs text, an attachment, or both — but not neither.
  defp validate_content_or_file(changeset) do
    content = get_field(changeset, :content)
    file_url = get_field(changeset, :file_url)

    if blank?(content) and blank?(file_url) do
      add_error(changeset, :content, "can't be blank")
    else
      changeset
    end
  end

  defp blank?(nil), do: true
  defp blank?(value), do: String.trim(value) == ""
end
