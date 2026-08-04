defmodule Backend.Repo.Migrations.AddFriendRequestPrivacyToUsers do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :friend_request_privacy, :string, null: false, default: "everyone"
    end
  end
end
