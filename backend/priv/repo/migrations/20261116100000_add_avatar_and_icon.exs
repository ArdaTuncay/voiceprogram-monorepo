defmodule Backend.Repo.Migrations.AddAvatarAndIcon do
  @moduledoc """
  A profile picture per user and an icon per server. Each holds the URL of
  an image from our own upload storage (see `Backend.Uploads.own_file_url?/1`),
  or nil for the default initials.
  """
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :avatar_url, :string
    end

    alter table(:servers) do
      add :icon_url, :string
    end
  end
end
