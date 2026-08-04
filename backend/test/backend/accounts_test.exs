defmodule Backend.AccountsTest do
  use Backend.DataCase, async: true

  alias Backend.Accounts
  alias Backend.Accounts.User
  alias Backend.Chat
  alias Backend.Chat.{Channel, Message}
  alias Backend.Friends
  alias Backend.Friends.Friendship
  alias Backend.Servers
  alias Backend.Servers.ServerMember

  describe "verify_password?/2" do
    test "true for the correct password" do
      user = user_fixture(%{"password" => "password123"})

      assert Accounts.verify_password?(user, "password123")
    end

    test "false for a wrong password" do
      user = user_fixture(%{"password" => "password123"})

      refute Accounts.verify_password?(user, "wrong-password")
    end
  end

  describe "update_username/2" do
    test "updates the username on success" do
      user = user_fixture()

      assert {:ok, updated} = Accounts.update_username(user, "brand_new_name")
      assert updated.username == "brand_new_name"
      assert Accounts.get_user_by_username("brand_new_name").id == user.id
    end

    test "rejects a username already taken by another user" do
      _existing = user_fixture(%{"username" => "taken_name"})
      user = user_fixture()

      assert {:error, changeset} = Accounts.update_username(user, "taken_name")
      assert "has already been taken" in errors_on(changeset).username
    end

    test "rejects an invalid format" do
      user = user_fixture()

      assert {:error, changeset} = Accounts.update_username(user, "not valid!")
      assert %{username: [_ | _]} = errors_on(changeset)
    end

    test "does not touch token_version" do
      user = user_fixture()

      assert {:ok, updated} = Accounts.update_username(user, "someone_else_entirely")
      assert updated.token_version == user.token_version
    end
  end

  describe "update_email/2" do
    test "updates the email on success" do
      user = user_fixture()

      assert {:ok, updated} = Accounts.update_email(user, "brandnew@example.com")
      assert updated.email == "brandnew@example.com"
      assert Accounts.get_user_by_email("brandnew@example.com").id == user.id
    end

    test "rejects an email already taken by another user" do
      _existing = user_fixture(%{"email" => "taken@example.com"})
      user = user_fixture()

      assert {:error, changeset} = Accounts.update_email(user, "taken@example.com")
      assert "has already been taken" in errors_on(changeset).email
    end

    test "rejects an invalid format" do
      user = user_fixture()

      assert {:error, changeset} = Accounts.update_email(user, "not-an-email")
      assert %{email: [_ | _]} = errors_on(changeset)
    end

    test "does not touch token_version" do
      user = user_fixture()

      assert {:ok, updated} = Accounts.update_email(user, "someoneelse@example.com")
      assert updated.token_version == user.token_version
    end
  end

  describe "update_password/3" do
    test "updates the password hash on success" do
      user = user_fixture(%{"password" => "old-password123"})

      assert {:ok, updated} = Accounts.update_password(user, "old-password123", "new-password456")
      assert Accounts.verify_password?(updated, "new-password456")
      refute Accounts.verify_password?(updated, "old-password123")
    end

    test "rejects the wrong current password without changing anything" do
      user = user_fixture(%{"password" => "old-password123"})

      assert {:error, :invalid_current_password} =
               Accounts.update_password(user, "totally-wrong", "new-password456")

      reloaded = Accounts.get_user(user.id)
      assert Accounts.verify_password?(reloaded, "old-password123")
      assert reloaded.token_version == user.token_version
    end

    test "rejects a too-short new password" do
      user = user_fixture(%{"password" => "old-password123"})

      assert {:error, changeset} = Accounts.update_password(user, "old-password123", "short")
      assert %{password: [_ | _]} = errors_on(changeset)
    end

    test "bumps token_version on success, invalidating every previously issued token" do
      user = user_fixture(%{"password" => "old-password123"})
      old_token = token_for(user)
      assert {:ok, _} = Accounts.authenticate_token(old_token)

      assert {:ok, updated} = Accounts.update_password(user, "old-password123", "new-password456")

      assert updated.token_version == user.token_version + 1
      assert {:error, :invalid} = Accounts.authenticate_token(old_token)
    end
  end

  describe "update_friend_request_privacy/2" do
    test "defaults to \"everyone\" for a freshly registered user" do
      user = user_fixture()
      assert user.friend_request_privacy == "everyone"
    end

    test "updates to \"nobody\" and back" do
      user = user_fixture()

      assert {:ok, updated} = Accounts.update_friend_request_privacy(user, "nobody")
      assert updated.friend_request_privacy == "nobody"

      assert {:ok, updated} = Accounts.update_friend_request_privacy(updated, "everyone")
      assert updated.friend_request_privacy == "everyone"
    end

    test "rejects a value other than everyone/nobody" do
      user = user_fixture()
      assert {:error, changeset} = Accounts.update_friend_request_privacy(user, "friends_only")
      assert %{friend_request_privacy: [_ | _]} = errors_on(changeset)
    end

    test "does not touch token_version" do
      user = user_fixture()
      assert {:ok, updated} = Accounts.update_friend_request_privacy(user, "nobody")
      assert updated.token_version == user.token_version
    end
  end

  describe "display_username/1" do
    test "returns the real username for a normal account" do
      user = user_fixture(%{"username" => "regular_joe"})
      assert Accounts.display_username(user) == "regular_joe"
    end

    test "returns the placeholder for a deleted account" do
      user = user_fixture(%{"password" => "correct-password"})
      {:ok, anonymized} = Accounts.delete_account(user, "correct-password")

      assert Accounts.display_username(anonymized) == "[silinmiş kullanıcı]"
    end

    test "returns nil for nil (no author)" do
      assert Accounts.display_username(nil) == nil
    end
  end

  describe "delete_account/2" do
    test "anonymizes username, email, and password hash, and marks deleted_at" do
      user = user_fixture(%{"password" => "correct-password"})

      assert {:ok, anonymized} = Accounts.delete_account(user, "correct-password")

      assert anonymized.id == user.id
      assert anonymized.username =~ ~r/^deleted_user_[0-9a-f]{12}$/
      assert anonymized.email =~ ~r/^deleted-[0-9a-f]{12}@deleted\.invalid$/
      refute Accounts.verify_password?(anonymized, "correct-password")
      assert anonymized.status == "offline"
      assert %DateTime{} = anonymized.deleted_at
      assert User.deleted?(anonymized)
    end

    test "bumps token_version, invalidating every previously issued token" do
      user = user_fixture(%{"password" => "correct-password"})
      old_token = token_for(user)
      assert {:ok, _} = Accounts.authenticate_token(old_token)

      assert {:ok, anonymized} = Accounts.delete_account(user, "correct-password")

      assert anonymized.token_version == user.token_version + 1
      assert {:error, :invalid} = Accounts.authenticate_token(old_token)
    end

    test "rejects the wrong current password without changing anything" do
      user = user_fixture(%{"password" => "correct-password"})

      assert {:error, :invalid_current_password} = Accounts.delete_account(user, "totally-wrong")

      reloaded = Accounts.get_user(user.id)
      assert reloaded.username == user.username
      assert reloaded.email == user.email
      assert reloaded.deleted_at == nil
      assert reloaded.token_version == user.token_version
    end

    test "removes friendships and blocks the deleted user was party to, in either direction" do
      a = user_fixture(%{"password" => "correct-password"})
      b = user_fixture()
      c = user_fixture()
      befriend_fixture(a, b)
      {:ok, _} = Friends.block_user(c.id, a.id)

      assert {:ok, _} = Accounts.delete_account(a, "correct-password")

      assert Repo.aggregate(Friendship, :count) == 0
    end

    test "leaves friendships/blocks between other users untouched" do
      a = user_fixture(%{"password" => "correct-password"})
      b = user_fixture()
      c = user_fixture()
      befriend_fixture(b, c)

      assert {:ok, _} = Accounts.delete_account(a, "correct-password")

      assert Friends.friends?(b.id, c.id)
    end

    test "an existing DM room and its message history survive, with the author's identity hidden" do
      a = user_fixture(%{"password" => "correct-password"})
      b = user_fixture()
      room = dm_room_fixture(a, b)

      {:ok, _msg} =
        Backend.DirectMessages.create_message(%{
          content: "hello before deletion",
          user_id: a.id,
          dm_room_id: room.id
        })

      assert {:ok, _} = Accounts.delete_account(a, "correct-password")

      assert Backend.DirectMessages.get_room(room.id) != nil
      [message] = Backend.DirectMessages.list_messages(room.id)
      assert message.content == "hello before deletion"

      [room_view] = Backend.DirectMessages.list_rooms_for_user(b.id)
      assert room_view.username == "[silinmiş kullanıcı]"
    end

    test "removes a plain (non-owner) server membership entirely" do
      owner = user_fixture()
      server = server_fixture(owner)
      member = user_fixture(%{"password" => "correct-password"})
      add_member_fixture(server, member)

      assert {:ok, _} = Accounts.delete_account(member, "correct-password")

      refute Servers.member?(server.id, member.id)
      assert Servers.get_server(server.id) != nil
    end

    test "deletes an owned server outright (with its channels/messages) when there are no other members" do
      owner = user_fixture(%{"password" => "correct-password"})
      server = server_fixture(owner)
      channel = default_channel(server)

      {:ok, message} =
        Chat.create_message(%{content: "hi", user_id: owner.id, channel_id: channel.id})

      assert {:ok, _} = Accounts.delete_account(owner, "correct-password")

      assert Servers.get_server(server.id) == nil
      assert Repo.get(Channel, channel.id) == nil
      assert Repo.get(Message, message.id) == nil
    end

    test "transfers ownership to the oldest other member when other members exist" do
      owner = user_fixture(%{"password" => "correct-password"})
      server = server_fixture(owner)
      first_member = user_fixture()
      add_member_fixture(server, first_member)
      second_member = user_fixture()
      add_member_fixture(server, second_member)

      assert {:ok, _} = Accounts.delete_account(owner, "correct-password")

      updated_server = Servers.get_server(server.id)
      assert updated_server.owner_id == first_member.id
      refute Servers.member?(server.id, owner.id)
      assert Servers.member?(server.id, first_member.id)
      assert Servers.member?(server.id, second_member.id)

      new_owner_membership =
        Repo.get_by(ServerMember, server_id: server.id, user_id: first_member.id)

      assert new_owner_membership.role == "owner"
    end

    test "atomic: a genuine failure partway through rolls back every write in the transaction" do
      owner = user_fixture(%{"password" => "correct-password"})

      healthy_server = server_fixture(owner)
      healthy_other_member = user_fixture()
      add_member_fixture(healthy_server, healthy_other_member)

      broken_server = server_fixture(owner)
      broken_other_member = user_fixture()
      add_member_fixture(broken_server, broken_other_member)

      # Force a real changeset failure in the ownership-transfer branch of
      # resolve_server_outcome/3: Server.changeset/2's validate_required(:name)
      # checks get_field/2 (changes, falling back to the existing row), so a
      # blank name planted directly at the DB level (bypassing the app's own
      # changeset, which would never allow this — the column itself only
      # enforces NOT NULL, not non-blank) is rejected the moment
      # delete_account/2 tries to update this row's owner_id, without us
      # ever touching :name ourselves.
      Repo.query!("UPDATE servers SET name = '' WHERE id = $1", [
        Ecto.UUID.dump!(broken_server.id)
      ])

      assert {:error, %Ecto.Changeset{}} = Accounts.delete_account(owner, "correct-password")

      # Nothing committed — not even the healthy server's transfer, which
      # would have succeeded on its own had it been processed first within
      # the same (now fully rolled-back) database transaction.
      reloaded_owner = Accounts.get_user(owner.id)
      assert reloaded_owner.deleted_at == nil
      assert reloaded_owner.username == owner.username

      assert Servers.get_server(healthy_server.id).owner_id == owner.id
      assert Servers.member?(healthy_server.id, owner.id)
      assert Servers.get_server(broken_server.id).owner_id == owner.id
    end
  end
end
