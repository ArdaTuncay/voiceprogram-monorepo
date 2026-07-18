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
  end
end
