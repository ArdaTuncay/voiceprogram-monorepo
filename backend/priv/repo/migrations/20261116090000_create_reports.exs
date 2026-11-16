defmodule Backend.Repo.Migrations.CreateReports do
  @moduledoc """
  Message reports (see `Backend.Reports`). A report on a channel message
  carries its `server_id` and is reviewed by that server's owner and
  moderators; a DM report has no server and goes to the platform by email.
  `content` keeps a copy of the message so deleting it doesn't erase the
  evidence; the message references are nilified rather than cascading.
  """
  use Ecto.Migration

  def change do
    create table(:reports, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :reporter_id, references(:users, type: :binary_id, on_delete: :nilify_all)
      add :reported_user_id, references(:users, type: :binary_id, on_delete: :nilify_all)
      add :server_id, references(:servers, type: :binary_id, on_delete: :delete_all)
      add :message_id, references(:messages, type: :binary_id, on_delete: :nilify_all)
      add :dm_message_id, references(:dm_messages, type: :binary_id, on_delete: :nilify_all)
      add :reason, :string, size: 20, null: false
      add :details, :string, size: 500
      add :content, :text
      add :file_url, :string
      add :status, :string, size: 20, null: false, default: "open"
      add :resolved_by_id, references(:users, type: :binary_id, on_delete: :nilify_all)
      add :resolved_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create index(:reports, [:server_id, :status])

    create unique_index(:reports, [:reporter_id, :message_id],
             where: "message_id IS NOT NULL",
             name: :reports_reporter_message_index
           )

    create unique_index(:reports, [:reporter_id, :dm_message_id],
             where: "dm_message_id IS NOT NULL",
             name: :reports_reporter_dm_message_index
           )
  end
end
