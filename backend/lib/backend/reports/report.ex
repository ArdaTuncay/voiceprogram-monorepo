defmodule Backend.Reports.Report do
  @moduledoc "A user's report of a message — see `Backend.Reports`."
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @reasons ~w(spam harassment inappropriate other)
  @review_statuses ~w(resolved dismissed)

  schema "reports" do
    belongs_to :reporter, User
    belongs_to :reported_user, User
    belongs_to :resolved_by, User
    field :server_id, :binary_id
    field :message_id, :binary_id
    field :dm_message_id, :binary_id
    field :reason, :string
    field :details, :string
    field :content, :string
    field :file_url, :string
    field :status, :string, default: "open"
    field :resolved_at, :utc_datetime

    timestamps(type: :utc_datetime)
  end

  @doc "A new report. `Backend.Reports` sets everything but reason and details."
  def create_changeset(report, attrs) do
    report
    |> cast(attrs, [:reason, :details])
    |> validate_required([:reason])
    |> validate_inclusion(:reason, @reasons)
    |> update_change(:details, &String.trim/1)
    |> validate_length(:details, max: 500)
    |> unique_constraint(:message_id, name: :reports_reporter_message_index)
    |> unique_constraint(:dm_message_id, name: :reports_reporter_dm_message_index)
  end

  @doc "The statuses a review can set."
  def review_statuses, do: @review_statuses

  @doc "Marks a report resolved or dismissed by `reviewer_id` (see `review_statuses/0`)."
  def review_changeset(report, status, reviewer_id) when status in @review_statuses do
    change(report,
      status: status,
      resolved_by_id: reviewer_id,
      resolved_at: DateTime.utc_now(:second)
    )
  end
end
