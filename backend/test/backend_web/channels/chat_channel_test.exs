defmodule BackendWeb.ChatChannelTest do
  use BackendWeb.ChannelCase, async: true

  alias Backend.Chat

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    channel = default_channel(server)
    member = user_fixture()
    add_member_fixture(server, member)
    stranger = user_fixture()

    %{owner: owner, server: server, channel: channel, member: member, stranger: stranger}
  end

  test "connect/3 rejects an invalid token" do
    assert :error = connect(BackendWeb.UserSocket, %{"token" => "not-a-real-token"})
  end

  test "connect/3 rejects a token revoked by logout_all", %{owner: owner} do
    token = token_for(owner)
    {:ok, _} = Backend.Accounts.revoke_all_tokens(owner)

    assert :error = connect(BackendWeb.UserSocket, %{"token" => token})
  end

  test "join is rejected for a user who isn't a server member", %{
    channel: channel,
    stranger: stranger
  } do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(stranger)})

    assert {:error, %{reason: "not authorized"}} =
             subscribe_and_join(socket, "chat:#{channel.id}", %{})
  end

  test "join is rejected for a nonexistent channel id", %{owner: owner} do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})

    assert {:error, %{reason: "channel not found"}} =
             subscribe_and_join(socket, "chat:#{Ecto.UUID.generate()}", %{})
  end

  test "a member joins successfully and gets message history", %{owner: owner, channel: channel} do
    {:ok, message} =
      Chat.create_message(%{content: "already here", user_id: owner.id, channel_id: channel.id})

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})

    assert {:ok, %{messages: messages}, _socket} =
             subscribe_and_join(socket, "chat:#{channel.id}", %{})

    assert [%{id: id}] = messages
    assert id == message.id
  end

  test "shout persists and broadcasts to everyone joined to the channel",
       %{owner: owner, member: member, channel: channel} do
    {:ok, owner_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, member_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(member)})

    {:ok, _, owner_socket} = subscribe_and_join(owner_socket, "chat:#{channel.id}", %{})
    {:ok, _, _member_socket} = subscribe_and_join(member_socket, "chat:#{channel.id}", %{})

    ref = push(owner_socket, "shout", %{"content" => "hello room"})
    assert_reply ref, :ok

    assert_broadcast "shout", %{content: "hello room", user_id: user_id}
    assert user_id == owner.id
    assert [%{content: "hello room"}] = Chat.list_messages(channel.id)
  end

  test "toggle_reaction broadcasts the updated grouped reactions", %{
    owner: owner,
    channel: channel
  } do
    {:ok, message} =
      Chat.create_message(%{content: "react to me", user_id: owner.id, channel_id: channel.id})

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _, socket} = subscribe_and_join(socket, "chat:#{channel.id}", %{})

    ref = push(socket, "toggle_reaction", %{"message_id" => message.id, "emoji" => "🔥"})
    assert_reply ref, :ok
    assert_broadcast "reaction_toggled", %{message_id: message_id, reactions: reactions}
    assert message_id == message.id
    assert [%{emoji: "🔥", count: 1, user_ids: [user_id]}] = reactions
    assert user_id == owner.id
  end

  test "toggle_reaction rejects a message id from a different channel",
       %{owner: owner, server: server, channel: channel} do
    {:ok, other_channel} =
      Backend.Servers.create_channel(server.id, %{"name" => "other", "type" => "text"})

    {:ok, message} =
      Chat.create_message(%{content: "hi", user_id: owner.id, channel_id: other_channel.id})

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _, socket} = subscribe_and_join(socket, "chat:#{channel.id}", %{})

    ref = push(socket, "toggle_reaction", %{"message_id" => message.id, "emoji" => "🔥"})
    assert_reply ref, :error, %{reason: "message_not_found"}
  end

  test "shout is rate-limited after 15 messages/10s, and does not persist or broadcast the 16th",
       %{owner: owner, channel: channel} do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _, socket} = subscribe_and_join(socket, "chat:#{channel.id}", %{})

    for n <- 1..15 do
      ref = push(socket, "shout", %{"content" => "msg #{n}"})
      assert_reply ref, :ok
      assert_broadcast "shout", %{content: "msg " <> _}
    end

    ref = push(socket, "shout", %{"content" => "one too many"})
    assert_reply ref, :error, %{reason: "rate_limited"}
    refute_broadcast "shout", %{content: "one too many"}

    assert length(Chat.list_messages(channel.id)) == 15
  end

  test "a different channel has its own shout rate-limit bucket",
       %{owner: owner, server: server, channel: channel} do
    {:ok, other_channel} =
      Backend.Servers.create_channel(server.id, %{"name" => "other", "type" => "text"})

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _, socket} = subscribe_and_join(socket, "chat:#{channel.id}", %{})

    for n <- 1..15 do
      ref = push(socket, "shout", %{"content" => "msg #{n}"})
      assert_reply ref, :ok
    end

    ref = push(socket, "shout", %{"content" => "blocked here"})
    assert_reply ref, :error, %{reason: "rate_limited"}

    {:ok, other_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _, other_socket} = subscribe_and_join(other_socket, "chat:#{other_channel.id}", %{})

    ref = push(other_socket, "shout", %{"content" => "still allowed"})
    assert_reply ref, :ok
  end

  test "update_message is rate-limited after 10 edits/min", %{owner: owner, channel: channel} do
    {:ok, message} =
      Chat.create_message(%{content: "original", user_id: owner.id, channel_id: channel.id})

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _, socket} = subscribe_and_join(socket, "chat:#{channel.id}", %{})

    for n <- 1..10 do
      ref =
        push(socket, "update_message", %{"message_id" => message.id, "content" => "edit #{n}"})

      assert_reply ref, :ok
    end

    ref = push(socket, "update_message", %{"message_id" => message.id, "content" => "edit 11"})
    assert_reply ref, :error, %{reason: "rate_limited"}

    assert %{content: "edit 10"} =
             channel.id |> Chat.list_messages() |> Enum.find(&(&1.id == message.id))
  end

  test "toggle_reaction is rate-limited after 30 toggles/min", %{owner: owner, channel: channel} do
    {:ok, message} =
      Chat.create_message(%{content: "react to me", user_id: owner.id, channel_id: channel.id})

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _, socket} = subscribe_and_join(socket, "chat:#{channel.id}", %{})

    emojis = for n <- 1..30, do: <<0x1F600 + n::utf8>>

    for emoji <- emojis do
      ref = push(socket, "toggle_reaction", %{"message_id" => message.id, "emoji" => emoji})
      assert_reply ref, :ok
    end

    ref = push(socket, "toggle_reaction", %{"message_id" => message.id, "emoji" => "🔥"})
    assert_reply ref, :error, %{reason: "rate_limited"}
  end
end
