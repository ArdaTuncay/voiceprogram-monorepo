defmodule Backend.DirectMessagesTest do
  use Backend.DataCase, async: true

  alias Backend.DirectMessages

  describe "member?/2" do
    test "true for either participant" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      assert DirectMessages.member?(room, a.id)
      assert DirectMessages.member?(room, b.id)
    end

    test "false for an unrelated user" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)
      stranger = user_fixture()

      refute DirectMessages.member?(room, stranger.id)
    end
  end

  describe "list_rooms_for_user/1" do
    test "includes each room's unread_count for the given user" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      {:ok, _} = DirectMessages.create_message(%{content: "hi", user_id: b.id, dm_room_id: room.id})

      [view] = DirectMessages.list_rooms_for_user(a.id)
      assert view.id == room.id
      assert view.unread_count == 1

      [other_view] = DirectMessages.list_rooms_for_user(b.id)
      assert other_view.unread_count == 0
    end
  end

  describe "open_room/2" do
    test "rejects opening a room between users who aren't friends" do
      a = user_fixture()
      b = user_fixture()

      assert {:error, :not_friends} = DirectMessages.open_room(a.id, %{"user_id" => b.id})
    end

    test "the same pair always resolves to the same room, regardless of who opens it" do
      a = user_fixture()
      b = user_fixture()
      befriend_fixture(a, b)

      {:ok, room_ab} = DirectMessages.open_room(a.id, %{"user_id" => b.id})
      {:ok, room_ba} = DirectMessages.open_room(b.id, %{"user_id" => a.id})

      assert room_ab.id == room_ba.id
    end
  end

  describe "toggle_reaction/4" do
    test "rejects reacting to a message that belongs to a different room" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)
      c = user_fixture()
      other_room = dm_room_fixture(a, c)

      {:ok, message} =
        DirectMessages.create_message(%{content: "hi", user_id: a.id, dm_room_id: room.id})

      assert {:error, :message_not_found} =
               DirectMessages.toggle_reaction(message.id, other_room.id, a.id, "👍")
    end

    test "adds and removes a reaction within the correct room scope" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      {:ok, message} =
        DirectMessages.create_message(%{content: "hi", user_id: a.id, dm_room_id: room.id})

      assert {:ok, [%{emoji: "❤️", count: 1, user_ids: [user_id]}]} =
               DirectMessages.toggle_reaction(message.id, room.id, b.id, "❤️")

      assert user_id == b.id
      assert {:ok, []} = DirectMessages.toggle_reaction(message.id, room.id, b.id, "❤️")
    end
  end

  describe "list_messages/2" do
    test "with :before_id, returns only messages older than the cursor, in chronological order" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      messages =
        for i <- 1..5 do
          {:ok, message} =
            DirectMessages.create_message(%{
              content: "msg#{i}",
              user_id: a.id,
              dm_room_id: room.id
            })

          message
        end

      [m1, m2, m3, m4, m5] = messages

      page = DirectMessages.list_messages(room.id, before_id: m5.id, limit: 2)
      assert Enum.map(page, & &1.id) == [m3.id, m4.id]

      older_page = DirectMessages.list_messages(room.id, before_id: m3.id, limit: 2)
      assert Enum.map(older_page, & &1.id) == [m1.id, m2.id]
    end

    test "with an unknown or cross-room :before_id, returns no messages" do
      a = user_fixture()
      b = user_fixture()
      c = user_fixture()
      room = dm_room_fixture(a, b)
      other_room = dm_room_fixture(a, c)

      {:ok, _} =
        DirectMessages.create_message(%{content: "hi", user_id: a.id, dm_room_id: room.id})

      {:ok, other_message} =
        DirectMessages.create_message(%{content: "hi", user_id: a.id, dm_room_id: other_room.id})

      assert DirectMessages.list_messages(room.id, before_id: other_message.id) == []
      assert DirectMessages.list_messages(room.id, before_id: Ecto.UUID.generate()) == []
    end
  end

  describe "open_room/2 with a block in place" do
    test "rejects opening a new room when the target blocked the caller" do
      a = user_fixture()
      b = user_fixture()
      {:ok, _} = Backend.Friends.block_user(b.id, a.id)

      assert {:error, :blocked} = DirectMessages.open_room(a.id, %{"user_id" => b.id})
    end

    test "rejects opening a new room when the caller blocked the target" do
      a = user_fixture()
      b = user_fixture()
      {:ok, _} = Backend.Friends.block_user(a.id, b.id)

      assert {:error, :blocked} = DirectMessages.open_room(a.id, %{"user_id" => b.id})
    end

    test "an existing room's message history survives a block untouched" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      {:ok, message} =
        DirectMessages.create_message(%{
          content: "hello before the block",
          user_id: a.id,
          dm_room_id: room.id
        })

      {:ok, _} = Backend.Friends.block_user(a.id, b.id)

      assert DirectMessages.get_room(room.id) != nil
      messages = DirectMessages.list_messages(room.id)
      assert Enum.map(messages, & &1.id) == [message.id]
    end
  end

  describe "unread_count/2" do
    test "counts every message in the room when nothing has ever been marked read" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      {:ok, _} = DirectMessages.create_message(%{content: "one", user_id: a.id, dm_room_id: room.id})
      {:ok, _} = DirectMessages.create_message(%{content: "two", user_id: a.id, dm_room_id: room.id})

      assert DirectMessages.unread_count(b.id, room.id) == 2
    end

    test "never counts the viewer's own messages" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      {:ok, _} = DirectMessages.create_message(%{content: "from a", user_id: a.id, dm_room_id: room.id})
      {:ok, _} = DirectMessages.create_message(%{content: "from a again", user_id: a.id, dm_room_id: room.id})

      assert DirectMessages.unread_count(a.id, room.id) == 0
    end

    test "only counts messages sent after the viewer's last-read seq" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      {:ok, m1} = DirectMessages.create_message(%{content: "one", user_id: a.id, dm_room_id: room.id})
      {:ok, _m2} = DirectMessages.create_message(%{content: "two", user_id: a.id, dm_room_id: room.id})

      {:ok, _} = DirectMessages.mark_room_read(b.id, room.id, m1.seq)

      assert DirectMessages.unread_count(b.id, room.id) == 1
    end

    test "reading up through the newest message's seq leaves nothing unread" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      {:ok, _m1} = DirectMessages.create_message(%{content: "one", user_id: a.id, dm_room_id: room.id})
      {:ok, m2} = DirectMessages.create_message(%{content: "two", user_id: a.id, dm_room_id: room.id})

      {:ok, _} = DirectMessages.mark_room_read(b.id, room.id, m2.seq)

      assert DirectMessages.unread_count(b.id, room.id) == 0
    end

    test "a different room's read position doesn't affect this room's count" do
      a = user_fixture()
      b = user_fixture()
      c = user_fixture()
      room = dm_room_fixture(a, b)
      other_room = dm_room_fixture(a, c)

      {:ok, m1} = DirectMessages.create_message(%{content: "hi", user_id: a.id, dm_room_id: other_room.id})
      {:ok, _} = DirectMessages.mark_room_read(a.id, other_room.id, m1.seq)

      {:ok, _} = DirectMessages.create_message(%{content: "hi", user_id: b.id, dm_room_id: room.id})

      assert DirectMessages.unread_count(a.id, room.id) == 1
    end
  end

  describe "mark_room_read/3" do
    test "creates a read position on first call" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      assert {:ok, %Backend.DirectMessages.DmRoomRead{last_read_seq: 5}} =
               DirectMessages.mark_room_read(a.id, room.id, 5)
    end

    test "upserts — a second call updates the same row instead of creating a duplicate" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      {:ok, first} = DirectMessages.mark_room_read(a.id, room.id, 3)
      {:ok, second} = DirectMessages.mark_room_read(a.id, room.id, 7)

      assert first.id == second.id
      assert second.last_read_seq == 7

      count =
        Backend.DirectMessages.DmRoomRead
        |> where(user_id: ^a.id, dm_room_id: ^room.id)
        |> Backend.Repo.aggregate(:count)

      assert count == 1
    end
  end

  describe "delete_message/2" do
    test "the author can delete their own message — content/file fields are actually wiped" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      {:ok, message} =
        DirectMessages.create_message(%{
          content: "oops",
          file_url: "http://example.com/f.png",
          file_type: "image/png",
          user_id: a.id,
          dm_room_id: room.id
        })

      assert {:ok, deleted} =
               DirectMessages.delete_message(message.id, %{user_id: a.id, dm_room_id: room.id})

      assert deleted.content == nil
      assert deleted.file_url == nil
      assert deleted.file_type == nil
      assert deleted.deleted_at != nil
    end

    # DMs have no owner/moderator concept (unlike Backend.Chat.delete_message/2) —
    # the other participant is a plain unauthorized caller here, nothing more.
    test "the other participant cannot delete a message they didn't write" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      {:ok, message} =
        DirectMessages.create_message(%{content: "oops", user_id: a.id, dm_room_id: room.id})

      assert {:error, :not_authorized} =
               DirectMessages.delete_message(message.id, %{user_id: b.id, dm_room_id: room.id})

      assert %{content: "oops"} =
               room.id |> DirectMessages.list_messages() |> Enum.find(&(&1.id == message.id))
    end

    test "rejects a nonexistent message id" do
      a = user_fixture()
      b = user_fixture()
      room = dm_room_fixture(a, b)

      assert {:error, :not_found} =
               DirectMessages.delete_message(Ecto.UUID.generate(), %{
                 user_id: a.id,
                 dm_room_id: room.id
               })
    end

    test "rejects deleting a message scoped to a different room" do
      a = user_fixture()
      b = user_fixture()
      c = user_fixture()
      room = dm_room_fixture(a, b)
      other_room = dm_room_fixture(a, c)

      {:ok, message} =
        DirectMessages.create_message(%{content: "hi", user_id: a.id, dm_room_id: room.id})

      assert {:error, :not_authorized} =
               DirectMessages.delete_message(message.id, %{
                 user_id: a.id,
                 dm_room_id: other_room.id
               })
    end
  end
end
