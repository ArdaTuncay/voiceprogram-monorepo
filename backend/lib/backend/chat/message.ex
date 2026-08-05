defmodule Backend.Chat.Message do
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Chat.Channel

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "messages" do
    field :content, :string
    field :file_url, :string
    field :file_type, :string
    field :is_edited, :boolean, default: false
    field :reactions, {:array, :map}, virtual: true, default: []
    # DB-assigned monotonic sequence — the authoritative send order for
    # cursor pagination (see Backend.Chat.list_messages/2). Never
    # client-settable, so it's not part of the changeset's cast fields.
    field :seq, :integer, read_after_writes: true
    # Soft-delete marker — set by delete_changeset/1, never cast directly
    # (there's no legitimate reason a client would ever set this via the
    # regular create/edit changesets). content/file_url/file_type are
    # wiped to nil at the same time, not just this flag — see
    # delete_changeset/1's own note.
    field :deleted_at, :utc_datetime
    belongs_to :user, User
    belongs_to :channel, Channel

    timestamps(type: :utc_datetime_usec, updated_at: false)
  end

  def changeset(message, attrs) do
    message
    |> cast(attrs, [:content, :file_url, :file_type, :user_id, :channel_id])
    |> validate_required([:user_id, :channel_id])
    |> validate_length(:content, max: 4000)
    |> validate_content_or_file()
    |> foreign_key_constraint(:user_id)
    |> foreign_key_constraint(:channel_id)
  end

  @doc "Changeset for editing an existing message's content — always marks it as edited."
  def edit_changeset(message, attrs) do
    message
    |> cast(attrs, [:content])
    |> validate_length(:content, max: 4000)
    |> validate_content_or_file()
    |> put_change(:is_edited, true)
  end

  @doc """
  Changeset for soft-deleting a message — a plain `change/2`, not `cast`,
  since this deliberately bypasses `validate_content_or_file/1`: the whole
  point is putting the message into a state that changeset would normally
  reject (no content *and* no file). Clears `content`/`file_url`/
  `file_type` outright rather than just setting `deleted_at`, so a
  deleted message's actual text/attachment is gone from the row itself —
  never just hidden behind a flag a client could route around by reading
  the same fields some other way.
  """
  def delete_changeset(message) do
    change(message,
      content: nil,
      file_url: nil,
      file_type: nil,
      deleted_at: DateTime.truncate(DateTime.utc_now(), :second)
    )
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
