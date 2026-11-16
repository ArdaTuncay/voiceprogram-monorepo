defmodule Backend.Repo.Migrations.AddAttachmentNameAndSize do
  @moduledoc """
  Non-image attachments (PDF, archives, documents) are shown as a card with
  the file's original name and size; the stored file itself has a random
  name (see `Backend.Uploads`). Both stay null for earlier messages and for
  text-only ones.
  """
  use Ecto.Migration

  def change do
    for table <- [:messages, :dm_messages] do
      alter table(table) do
        add :file_name, :string
        add :file_size, :integer
      end
    end
  end
end
