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
end
