defmodule Backend.AccountsTest do
  use Backend.DataCase, async: true

  alias Backend.Accounts

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
end
