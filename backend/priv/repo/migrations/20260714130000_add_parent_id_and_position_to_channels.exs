defmodule Backend.Repo.Migrations.AddParentIdAndPositionToChannels do
  use Ecto.Migration

  @moduledoc """
  `parent_id` (self-referential — a channel's category is just another row
  in the same table, with `type: "category"`) uses `nilify_all` rather than
  `delete_all`: deleting a category should ungroup its channels back to
  "Kategorisiz", not delete their history along with it.
  """

  def change do
    alter table(:channels) do
      add :parent_id, references(:channels, type: :binary_id, on_delete: :nilify_all)
      add :position, :integer, default: 0, null: false
    end

    create index(:channels, [:parent_id])
  end
end
