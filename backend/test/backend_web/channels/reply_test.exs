defmodule BackendWeb.ReplyTest do
  @moduledoc """
  Replying to a message. A reply points at an earlier message in the same
  channel (or DM room) and carries a short preview of it, so the client can
  show what's being answered without fetching it separately. A reply to a
  message somewhere else is refused; if the original is deleted later, the
  preview says so instead of keeping its text.
  """
  use BackendWeb.ChannelCase, async: true

  alias Backend.{Chat, DirectMessages}

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    channel = default_channel(server)
    member = user_fixture()
    add_member_fixture(server, member)

    {:ok, original} =
      Chat.create_message(%{content: "ilk mesaj", user_id: owner.id, channel_id: channel.id})

    %{owner: owner, server: server, channel: channel, member: member, original: original}
  end

  defp join_chat(user, channel) do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(user)})
    {:ok, reply, socket} = subscribe_and_join(socket, "chat:#{channel.id}", %{})
    {reply, socket}
  end

  test "a reply sent over the socket carries a preview of the original", ctx do
    {_, socket} = join_chat(ctx.member, ctx.channel)
    original_id = ctx.original.id
    owner_id = ctx.owner.id

    ref = push(socket, "shout", %{"content" => "cevap", "reply_to_id" => original_id})
    assert_reply ref, :ok

    assert_broadcast "shout", %{
      content: "cevap",
      reply_to: %{
        id: ^original_id,
        user_id: ^owner_id,
        content: "ilk mesaj",
        is_deleted: false
      }
    }
  end

  test "history comes back with reply previews too", ctx do
    {:ok, _} =
      Chat.create_message(%{
        content: "cevap",
        user_id: ctx.member.id,
        channel_id: ctx.channel.id,
        reply_to_id: ctx.original.id
      })

    {%{messages: messages}, _socket} = join_chat(ctx.owner, ctx.channel)
    reply = Enum.find(messages, &(&1.content == "cevap"))
    assert reply.reply_to.content == "ilk mesaj"
    assert Enum.find(messages, &(&1.content == "ilk mesaj")).reply_to == nil
  end

  test "a reply to a message in another channel is refused", ctx do
    other_server = server_fixture(ctx.owner)

    {:ok, elsewhere} =
      Chat.create_message(%{
        content: "başka yer",
        user_id: ctx.owner.id,
        channel_id: default_channel(other_server).id
      })

    assert {:error, changeset} =
             Chat.create_message(%{
               content: "cevap",
               user_id: ctx.member.id,
               channel_id: ctx.channel.id,
               reply_to_id: elsewhere.id
             })

    assert %{reply_to_id: [_]} = Backend.DataCase.errors_on(changeset)
  end

  test "the preview of a deleted original drops its text", ctx do
    {:ok, reply} =
      Chat.create_message(%{
        content: "cevap",
        user_id: ctx.member.id,
        channel_id: ctx.channel.id,
        reply_to_id: ctx.original.id
      })

    {:ok, _} =
      Chat.delete_message(ctx.original.id, %{user_id: ctx.owner.id, channel_id: ctx.channel.id})

    [listed] = Chat.list_messages(ctx.channel.id) |> Enum.filter(&(&1.id == reply.id))
    preview = BackendWeb.MessageJSON.reply_preview(listed)
    assert preview.is_deleted
    assert preview.content == nil
  end

  test "a long original is shortened in the preview", ctx do
    long = String.duplicate("a", 500)

    {:ok, original} =
      Chat.create_message(%{content: long, user_id: ctx.owner.id, channel_id: ctx.channel.id})

    {:ok, reply} =
      Chat.create_message(%{
        content: "cevap",
        user_id: ctx.member.id,
        channel_id: ctx.channel.id,
        reply_to_id: original.id
      })

    assert String.length(BackendWeb.MessageJSON.reply_preview(reply).content) == 200
  end

  describe "in a DM" do
    setup ctx do
      room = dm_room_fixture(ctx.owner, ctx.member)

      {:ok, dm} =
        DirectMessages.create_message(%{
          content: "dm ilk",
          user_id: ctx.owner.id,
          dm_room_id: room.id
        })

      %{room: room, dm: dm}
    end

    test "replies work over the DM socket", ctx do
      {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(ctx.member)})
      {:ok, _, socket} = subscribe_and_join(socket, "dm:#{ctx.room.id}", %{})
      dm_id = ctx.dm.id

      ref = push(socket, "shout", %{"content" => "dm cevap", "reply_to_id" => dm_id})
      assert_reply ref, :ok
      assert_broadcast "shout", %{reply_to: %{id: ^dm_id, content: "dm ilk"}}
    end

    test "a reply to a message from another DM room is refused", ctx do
      third = user_fixture()
      other_room = dm_room_fixture(ctx.owner, third)

      assert {:error, changeset} =
               DirectMessages.create_message(%{
                 content: "cevap",
                 user_id: ctx.owner.id,
                 dm_room_id: other_room.id,
                 reply_to_id: ctx.dm.id
               })

      assert %{reply_to_id: [_]} = Backend.DataCase.errors_on(changeset)
    end
  end
end
