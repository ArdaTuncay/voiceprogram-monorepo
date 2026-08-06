defmodule Backend.ChatTest do
  use Backend.DataCase, async: true

  alias Backend.Chat
  alias Backend.Presence

  describe "voice_occupants/1" do
    test "returns user_id + username for everyone currently tracked in the room, stripped of other Presence metadata" do
      room_id = Ecto.UUID.generate()

      {:ok, _} =
        Presence.track(self(), "voice:#{room_id}", "user-1", %{
          username: "Ada",
          online_at: 1,
          muted: true,
          deafened: false
        })

      {:ok, _} = Presence.track(self(), "voice:#{room_id}", "user-2", %{username: "Grace"})

      result = room_id |> Chat.voice_occupants() |> Enum.sort_by(& &1.user_id)

      assert result == [
               %{user_id: "user-1", username: "Ada"},
               %{user_id: "user-2", username: "Grace"}
             ]
    end

    test "returns an empty list for a room nobody is currently in" do
      assert Chat.voice_occupants(Ecto.UUID.generate()) == []
    end
  end

  describe "toggle_reaction/4" do
    test "adds a reaction, then removes it on a second toggle" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)

      {:ok, message} =
        Chat.create_message(%{content: "hi", user_id: owner.id, channel_id: channel.id})

      assert {:ok, [%{emoji: "👍", count: 1, user_ids: [user_id]}]} =
               Chat.toggle_reaction(message.id, channel.id, owner.id, "👍")

      assert user_id == owner.id

      assert {:ok, []} = Chat.toggle_reaction(message.id, channel.id, owner.id, "👍")
    end

    test "groups multiple users' reactions to the same emoji" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)
      member = user_fixture()
      add_member_fixture(server, member)

      {:ok, message} =
        Chat.create_message(%{content: "hi", user_id: owner.id, channel_id: channel.id})

      {:ok, _} = Chat.toggle_reaction(message.id, channel.id, owner.id, "🔥")

      assert {:ok, [%{emoji: "🔥", count: 2, user_ids: user_ids}]} =
               Chat.toggle_reaction(message.id, channel.id, member.id, "🔥")

      assert Enum.sort(user_ids) == Enum.sort([owner.id, member.id])
    end

    test "rejects reacting to a message that belongs to a different channel" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)

      {:ok, other_channel} =
        Backend.Servers.create_channel(server.id, %{"name" => "other", "type" => "text"})

      {:ok, message} =
        Chat.create_message(%{content: "hi", user_id: owner.id, channel_id: channel.id})

      # The message lives in `channel`, not `other_channel` — a client
      # can't forge a reaction onto a message outside the channel it's
      # actually authorized/scoped to via its join.
      assert {:error, :message_not_found} =
               Chat.toggle_reaction(message.id, other_channel.id, owner.id, "👍")
    end

    test "rejects a nonexistent message id" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)

      assert {:error, :message_not_found} =
               Chat.toggle_reaction(Ecto.UUID.generate(), channel.id, owner.id, "👍")
    end
  end

  describe "list_messages/2" do
    test "includes each message's grouped reactions" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)

      {:ok, message} =
        Chat.create_message(%{content: "hi", user_id: owner.id, channel_id: channel.id})

      {:ok, _} = Chat.toggle_reaction(message.id, channel.id, owner.id, "😮")

      assert [%{id: id, reactions: [%{emoji: "😮", count: 1}]}] = Chat.list_messages(channel.id)
      assert id == message.id
    end

    test "with :before_id, returns only messages older than the cursor, in chronological order" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)

      messages =
        for i <- 1..5 do
          {:ok, message} =
            Chat.create_message(%{content: "msg#{i}", user_id: owner.id, channel_id: channel.id})

          message
        end

      [m1, m2, m3, m4, m5] = messages

      page = Chat.list_messages(channel.id, before_id: m5.id, limit: 2)
      assert Enum.map(page, & &1.id) == [m3.id, m4.id]

      older_page = Chat.list_messages(channel.id, before_id: m3.id, limit: 2)
      assert Enum.map(older_page, & &1.id) == [m1.id, m2.id]
    end

    test "with an unknown or cross-channel :before_id, returns no messages" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)

      {:ok, other_channel} =
        Backend.Servers.create_channel(server.id, %{"name" => "other", "type" => "text"})

      {:ok, _} = Chat.create_message(%{content: "hi", user_id: owner.id, channel_id: channel.id})

      {:ok, other_message} =
        Chat.create_message(%{content: "hi", user_id: owner.id, channel_id: other_channel.id})

      assert Chat.list_messages(channel.id, before_id: other_message.id) == []
      assert Chat.list_messages(channel.id, before_id: Ecto.UUID.generate()) == []
    end
  end

  describe "delete_message/2" do
    test "the author can delete their own message — content/file fields are actually wiped" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)
      member = user_fixture()
      add_member_fixture(server, member)

      {:ok, message} =
        Chat.create_message(%{
          content: "oops",
          file_url: "http://example.com/f.png",
          file_type: "image/png",
          user_id: member.id,
          channel_id: channel.id
        })

      assert {:ok, deleted} =
               Chat.delete_message(message.id, %{user_id: member.id, channel_id: channel.id})

      assert deleted.content == nil
      assert deleted.file_url == nil
      assert deleted.file_type == nil
      assert deleted.deleted_at != nil
    end

    test "the server owner can delete another member's message even though they didn't write it" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)
      member = user_fixture()
      add_member_fixture(server, member)

      {:ok, message} =
        Chat.create_message(%{content: "oops", user_id: member.id, channel_id: channel.id})

      assert {:ok, deleted} =
               Chat.delete_message(message.id, %{user_id: owner.id, channel_id: channel.id})

      assert deleted.content == nil
      assert deleted.deleted_at != nil
    end

    test "a member who neither wrote the message nor owns the server cannot delete it" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)
      author = user_fixture()
      other_member = user_fixture()
      add_member_fixture(server, author)
      add_member_fixture(server, other_member)

      {:ok, message} =
        Chat.create_message(%{content: "oops", user_id: author.id, channel_id: channel.id})

      assert {:error, :not_authorized} =
               Chat.delete_message(message.id, %{
                 user_id: other_member.id,
                 channel_id: channel.id
               })

      assert %{content: "oops"} =
               channel.id |> Chat.list_messages() |> Enum.find(&(&1.id == message.id))
    end

    test "rejects a nonexistent message id" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)

      assert {:error, :not_found} =
               Chat.delete_message(Ecto.UUID.generate(), %{
                 user_id: owner.id,
                 channel_id: channel.id
               })
    end

    test "rejects deleting a message scoped to a different channel, even for the server owner" do
      owner = user_fixture()
      server = server_fixture(owner)
      channel = default_channel(server)

      {:ok, other_channel} =
        Backend.Servers.create_channel(server.id, %{"name" => "other", "type" => "text"})

      {:ok, message} =
        Chat.create_message(%{content: "hi", user_id: owner.id, channel_id: channel.id})

      assert {:error, :not_authorized} =
               Chat.delete_message(message.id, %{
                 user_id: owner.id,
                 channel_id: other_channel.id
               })
    end
  end
end
