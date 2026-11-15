defmodule Backend.Repo.Migrations.AddReplyToMessages do
  @moduledoc """
  Replies: a message may point at an earlier message in the same channel
  (or DM room). The link is cleared if the original row ever goes away;
  soft-deleting it keeps the link and the client shows "deleted".
  """
  use Ecto.Migration

  def change do
    alter table(:messages) do
      add :reply_to_id, references(:messages, type: :binary_id, on_delete: :nilify_all)
    end

    alter table(:dm_messages) do
      add :reply_to_id, references(:dm_messages, type: :binary_id, on_delete: :nilify_all)
    end
  end
end
