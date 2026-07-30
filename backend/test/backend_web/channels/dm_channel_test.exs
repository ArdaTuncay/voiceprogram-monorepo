defmodule BackendWeb.DmChannelTest do
  use BackendWeb.ChannelCase, async: true

  alias Backend.DirectMessages

  setup do
    a = user_fixture()
    b = user_fixture()
    room = dm_room_fixture(a, b)
    stranger = user_fixture()

    %{a: a, b: b, room: room, stranger: stranger}
  end

  test "connect/3 rejects an invalid token" do
    assert :error = connect(BackendWeb.UserSocket, %{"token" => "not-a-real-token"})
  end

  test "join is rejected for a user who isn't a participant", %{room: room, stranger: stranger} do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(stranger)})

    assert {:error, %{reason: "not authorized"}} =
             subscribe_and_join(socket, "dm:#{room.id}", %{})
  end

  test "join is rejected for a nonexistent room id", %{a: a} do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(a)})

    assert {:error, %{reason: "room not found"}} =
             subscribe_and_join(socket, "dm:#{Ecto.UUID.generate()}", %{})
  end

  test "a participant joins successfully and gets message history", %{a: a, room: room} do
    {:ok, message} =
      DirectMessages.create_message(%{content: "hi", user_id: a.id, dm_room_id: room.id})

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(a)})

    assert {:ok, %{messages: messages}, _socket} =
             subscribe_and_join(socket, "dm:#{room.id}", %{})

    assert [%{id: id}] = messages
    assert id == message.id
  end

  test "shout persists, broadcasts on the room topic, and notifies the other participant",
       %{a: a, b: b, room: room} do
    {:ok, a_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(a)})
    {:ok, _, a_socket} = subscribe_and_join(a_socket, "dm:#{room.id}", %{})

    {:ok, b_user_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(b)})
    {:ok, _reply, _socket} = subscribe_and_join(b_user_socket, "user:#{b.id}", %{})

    ref = push(a_socket, "shout", %{"content" => "hey there"})
    assert_reply ref, :ok

    assert_broadcast "shout", %{content: "hey there", user_id: user_id}
    assert user_id == a.id

    assert_broadcast "new_dm_message", %{content: "hey there", dm_room_id: room_id}
    assert room_id == room.id

    assert [%{content: "hey there"}] = DirectMessages.list_messages(room.id)
  end

  test "shout is rejected once either side has blocked the other, without touching existing history",
       %{a: a, b: b, room: room} do
    {:ok, existing} =
      DirectMessages.create_message(%{
        content: "before the block",
        user_id: a.id,
        dm_room_id: room.id
      })

    {:ok, _} = Backend.Friends.block_user(a.id, b.id)

    {:ok, a_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(a)})
    {:ok, _, a_socket} = subscribe_and_join(a_socket, "dm:#{room.id}", %{})

    ref = push(a_socket, "shout", %{"content" => "should not send"})
    assert_reply ref, :error, %{reason: "blocked"}

    assert [%{id: id}] = DirectMessages.list_messages(room.id)
    assert id == existing.id
  end

  test "toggle_reaction broadcasts the updated grouped reactions", %{a: a, b: b, room: room} do
    {:ok, message} =
      DirectMessages.create_message(%{content: "hi", user_id: a.id, dm_room_id: room.id})

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(b)})
    {:ok, _, socket} = subscribe_and_join(socket, "dm:#{room.id}", %{})

    ref = push(socket, "toggle_reaction", %{"message_id" => message.id, "emoji" => "❤️"})
    assert_reply ref, :ok
    assert_broadcast "reaction_toggled", %{message_id: message_id, reactions: reactions}
    assert message_id == message.id
    assert [%{emoji: "❤️", count: 1, user_ids: [user_id]}] = reactions
    assert user_id == b.id
  end

  test "toggle_reaction rejects a message id from a different room", %{a: a, b: b, room: room} do
    c = user_fixture()
    other_room = dm_room_fixture(a, c)

    {:ok, message} =
      DirectMessages.create_message(%{content: "hi", user_id: a.id, dm_room_id: other_room.id})

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(b)})
    {:ok, _, socket} = subscribe_and_join(socket, "dm:#{room.id}", %{})

    ref = push(socket, "toggle_reaction", %{"message_id" => message.id, "emoji" => "❤️"})
    assert_reply ref, :error, %{reason: "message_not_found"}
  end

  test "shout is rate-limited after 15 messages/10s, and does not persist or broadcast the 16th",
       %{a: a, room: room} do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(a)})
    {:ok, _, socket} = subscribe_and_join(socket, "dm:#{room.id}", %{})

    for n <- 1..15 do
      ref = push(socket, "shout", %{"content" => "msg #{n}"})
      assert_reply ref, :ok
      assert_broadcast "shout", %{content: "msg " <> _}
    end

    ref = push(socket, "shout", %{"content" => "one too many"})
    assert_reply ref, :error, %{reason: "rate_limited"}
    refute_broadcast "shout", %{content: "one too many"}

    assert length(DirectMessages.list_messages(room.id)) == 15
  end

  test "a different room has its own shout rate-limit bucket", %{a: a, room: room} do
    c = user_fixture()
    other_room = dm_room_fixture(a, c)

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(a)})
    {:ok, _, socket} = subscribe_and_join(socket, "dm:#{room.id}", %{})

    for n <- 1..15 do
      ref = push(socket, "shout", %{"content" => "msg #{n}"})
      assert_reply ref, :ok
    end

    ref = push(socket, "shout", %{"content" => "blocked here"})
    assert_reply ref, :error, %{reason: "rate_limited"}

    {:ok, other_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(a)})
    {:ok, _, other_socket} = subscribe_and_join(other_socket, "dm:#{other_room.id}", %{})

    ref = push(other_socket, "shout", %{"content" => "still allowed"})
    assert_reply ref, :ok
  end

  test "update_message is rate-limited after 10 edits/min", %{a: a, room: room} do
    {:ok, message} =
      DirectMessages.create_message(%{content: "original", user_id: a.id, dm_room_id: room.id})

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(a)})
    {:ok, _, socket} = subscribe_and_join(socket, "dm:#{room.id}", %{})

    for n <- 1..10 do
      ref =
        push(socket, "update_message", %{"message_id" => message.id, "content" => "edit #{n}"})

      assert_reply ref, :ok
    end

    ref = push(socket, "update_message", %{"message_id" => message.id, "content" => "edit 11"})
    assert_reply ref, :error, %{reason: "rate_limited"}

    assert %{content: "edit 10"} =
             room.id |> DirectMessages.list_messages() |> Enum.find(&(&1.id == message.id))
  end

  test "toggle_reaction is rate-limited after 30 toggles/min", %{a: a, room: room} do
    {:ok, message} =
      DirectMessages.create_message(%{content: "react to me", user_id: a.id, dm_room_id: room.id})

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(a)})
    {:ok, _, socket} = subscribe_and_join(socket, "dm:#{room.id}", %{})

    emojis = for n <- 1..30, do: <<0x1F600 + n::utf8>>

    for emoji <- emojis do
      ref = push(socket, "toggle_reaction", %{"message_id" => message.id, "emoji" => emoji})
      assert_reply ref, :ok
    end

    ref = push(socket, "toggle_reaction", %{"message_id" => message.id, "emoji" => "🔥"})
    assert_reply ref, :error, %{reason: "rate_limited"}
  end
end
