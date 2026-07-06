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
    belongs_to :user, User
    belongs_to :channel, Channel

    timestamps(type: :utc_datetime, updated_at: false)
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
