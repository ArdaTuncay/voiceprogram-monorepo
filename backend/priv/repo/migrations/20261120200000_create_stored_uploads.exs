defmodule Backend.Repo.Migrations.CreateStoredUploads do
  use Ecto.Migration

  # One row per file Zircle stores (attachments, avatars, server icons), with
  # its size — the running total behind the storage limit (see
  # Backend.Uploads.check_quota/1). Rows aren't removed when a file is
  # deleted, so the total only ever overestimates what's really stored.
  def change do
    create table(:stored_uploads) do
      add :file_url, :text, null: false
      add :size, :bigint, null: false
      timestamps(type: :utc_datetime, updated_at: false)
    end
  end
end
