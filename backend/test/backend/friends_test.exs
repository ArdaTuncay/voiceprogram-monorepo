defmodule Backend.FriendsTest do
  use Backend.DataCase, async: true

  alias Backend.Friends
  alias Backend.Friends.Friendship
  alias Ecto.Adapters.SQL.Sandbox

  describe "send_request/2" do
    test "creates a pending request" do
      a = user_fixture()
      b = user_fixture()

      assert {:ok, friendship} = Friends.send_request(a.id, %{"username" => b.username})
      assert friendship.status == "pending"
      assert friendship.user_id == a.id
      assert friendship.friend_id == b.id
    end

    test "a mutual request (B already asked A) auto-accepts instead of creating a second row" do
      a = user_fixture()
      b = user_fixture()

      {:ok, _} = Friends.send_request(b.id, %{"username" => a.username})
      assert {:ok, friendship} = Friends.send_request(a.id, %{"username" => b.username})

      assert friendship.status == "accepted"
      assert Repo.aggregate(Friendship, :count) == 1
    end

    test "rejects a duplicate pending request from the same user" do
      a = user_fixture()
      b = user_fixture()
      {:ok, _} = Friends.send_request(a.id, %{"username" => b.username})

      assert {:error, :already_pending} = Friends.send_request(a.id, %{"username" => b.username})
    end

    test "the symmetric index rejects a reverse-direction duplicate at the database level" do
      a = user_fixture()
      b = user_fixture()

      assert {:ok, _} =
               %Friendship{}
               |> Friendship.changeset(%{user_id: a.id, friend_id: b.id, status: "pending"})
               |> Repo.insert()

      assert {:error, changeset} =
               %Friendship{}
               |> Friendship.changeset(%{user_id: b.id, friend_id: a.id, status: "pending"})
               |> Repo.insert()

      assert "already have a pending or accepted friendship with this user" in errors_on(
               changeset
             ).user_id
    end

    test "two near-simultaneous mutual requests resolve to exactly one accepted friendship" do
      a = user_fixture()
      b = user_fixture()
      parent = self()

      task_a =
        Task.async(fn ->
          Sandbox.allow(Repo, parent, self())
          Friends.send_request(a.id, %{"username" => b.username})
        end)

      task_b =
        Task.async(fn ->
          Sandbox.allow(Repo, parent, self())
          Friends.send_request(b.id, %{"username" => a.username})
        end)

      # Whichever request's insert loses the DB-level race, create_pending/2
      # catches the symmetric constraint violation and resolves against the
      # winner instead of crashing or leaving a duplicate row — see
      # Backend.Friends. Regardless of exactly how the two attempts
      # interleaved, the outcome must be the same: one row, accepted.
      assert {:ok, _} = Task.await(task_a)
      assert {:ok, _} = Task.await(task_b)

      friendships = Repo.all(Friendship)
      assert length(friendships) == 1
      assert hd(friendships).status == "accepted"
    end

    test "rejects a request to a user whose friend_request_privacy is \"nobody\"" do
      a = user_fixture()
      b = user_fixture()
      {:ok, b} = Backend.Accounts.update_friend_request_privacy(b, "nobody")

      assert {:error, :requests_disabled} =
               Friends.send_request(a.id, %{"username" => b.username})

      assert Repo.aggregate(Friendship, :count) == 0
    end

    test "rejects a request to someone who blocked the sender" do
      a = user_fixture()
      b = user_fixture()
      {:ok, _} = Friends.block_user(b.id, a.id)

      assert {:error, :blocked_by_them} = Friends.send_request(a.id, %{"username" => b.username})
    end

    test "rejects a request from a user the sender already blocked" do
      a = user_fixture()
      b = user_fixture()
      {:ok, _} = Friends.block_user(a.id, b.id)

      assert {:error, :blocked_by_you} = Friends.send_request(a.id, %{"username" => b.username})
    end
  end

  describe "block_user/2" do
    test "creates a blocked row when there was no prior relationship" do
      a = user_fixture()
      b = user_fixture()

      assert {:ok, friendship} = Friends.block_user(a.id, b.id)
      assert friendship.status == "blocked"
      assert friendship.user_id == a.id
      assert friendship.friend_id == b.id
    end

    test "overwrites an existing accepted friendship instead of creating a second row" do
      a = user_fixture()
      b = user_fixture()
      {:ok, _} = Friends.send_request(a.id, %{"username" => b.username})
      {:ok, _} = Friends.accept_request(b.id, Repo.one(Friendship).id)
      assert Friends.friends?(a.id, b.id)

      assert {:ok, _} = Friends.block_user(a.id, b.id)

      refute Friends.friends?(a.id, b.id)
      assert Repo.aggregate(Friendship, :count) == 1
    end

    test "overwrites a pending request the target had sent, re-pointing the direction to the blocker" do
      a = user_fixture()
      b = user_fixture()
      {:ok, _} = Friends.send_request(b.id, %{"username" => a.username})

      assert {:ok, _} = Friends.block_user(a.id, b.id)

      friendship = Repo.one(Friendship)
      assert friendship.status == "blocked"
      assert friendship.user_id == a.id
      assert friendship.friend_id == b.id
    end

    test "rejects blocking yourself" do
      a = user_fixture()
      assert {:error, :cannot_block_self} = Friends.block_user(a.id, a.id)
    end

    test "rejects blocking a user that doesn't exist" do
      a = user_fixture()
      assert {:error, :user_not_found} = Friends.block_user(a.id, Ecto.UUID.generate())
    end
  end

  describe "unblock_user/2" do
    test "removes the block, letting a fresh friend request go through afterward" do
      a = user_fixture()
      b = user_fixture()
      {:ok, _} = Friends.block_user(a.id, b.id)

      assert {:ok, _} = Friends.unblock_user(a.id, b.id)
      assert Repo.aggregate(Friendship, :count) == 0
      assert {:ok, _} = Friends.send_request(a.id, %{"username" => b.username})
    end

    test "the blocked party cannot unblock themselves" do
      a = user_fixture()
      b = user_fixture()
      {:ok, _} = Friends.block_user(a.id, b.id)

      assert {:error, :not_blocked} = Friends.unblock_user(b.id, a.id)
    end

    test "returns :not_blocked when there is no block between the two users" do
      a = user_fixture()
      b = user_fixture()
      assert {:error, :not_blocked} = Friends.unblock_user(a.id, b.id)
    end
  end

  describe "blocked?/2 and blocked_either_way?/2" do
    test "blocked?/2 is true only for the blocker asking about the blocked user" do
      a = user_fixture()
      b = user_fixture()
      {:ok, _} = Friends.block_user(a.id, b.id)

      assert Friends.blocked?(a.id, b.id)
      refute Friends.blocked?(b.id, a.id)
    end

    test "blocked_either_way?/2 is true from both sides" do
      a = user_fixture()
      b = user_fixture()
      {:ok, _} = Friends.block_user(a.id, b.id)

      assert Friends.blocked_either_way?(a.id, b.id)
      assert Friends.blocked_either_way?(b.id, a.id)
    end

    test "blocked_either_way?/2 is false when there is no block" do
      a = user_fixture()
      b = user_fixture()
      refute Friends.blocked_either_way?(a.id, b.id)
    end
  end

  describe "list_blocked_users/1" do
    test "lists only users the caller blocked, not who blocked the caller" do
      a = user_fixture()
      b = user_fixture()
      c = user_fixture()
      {:ok, _} = Friends.block_user(a.id, b.id)
      {:ok, _} = Friends.block_user(c.id, a.id)

      assert [%{user_id: user_id, username: username}] = Friends.list_blocked_users(a.id)
      assert user_id == b.id
      assert username == b.username
    end

    test "is empty when the caller hasn't blocked anyone" do
      a = user_fixture()
      assert Friends.list_blocked_users(a.id) == []
    end
  end
end
