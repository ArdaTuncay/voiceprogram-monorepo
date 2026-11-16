defmodule BackendWeb.MessageFanoutTest do
  @moduledoc """
  "new_message" on each member's personal "user:<id>" channel — what drives
  unread badges and notifications for channels the member doesn't have
  open. Delivered through one shared topic per server that every member's
  UserChannel listens on (see `BackendWeb.UserChannel`), so the member
  list has to stay right as people join and leave.
  """
  use BackendWeb.ChannelCase, async: true

  alias Backend.Servers

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    channel = default_channel(server)
    member = user_fixture()
    add_member_fixture(server, member)

    %{owner: owner, server: server, channel: channel, member: member}
  end

  # Opens `user`'s personal channel, as every open Zircle tab does.
  defp open_user_channel(user) do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(user)})
    {:ok, _reply, socket} = subscribe_and_join(socket, "user:#{user.id}", %{})
    socket
  end

  defp say(user, channel, content) do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(user)})
    {:ok, _reply, socket} = subscribe_and_join(socket, "chat:#{channel.id}", %{})
    ref = push(socket, "shout", %{"content" => content})
    assert_reply ref, :ok
    socket
  end

  # Pushes go to the test process, which is every socket's transport here,
  # so whose channel pushed it is told apart by the topic.
  defp assert_new_message(user, content) do
    topic = "user:#{user.id}"

    assert_receive %Phoenix.Socket.Message{topic: ^topic, event: "new_message", payload: payload}

    assert payload.content == content
    payload
  end

  defp refute_new_message(user) do
    topic = "user:#{user.id}"
    refute_receive %Phoenix.Socket.Message{topic: ^topic, event: "new_message"}, 100
  end

  test "reaches every other member, with the channel it was in, but not the author",
       %{owner: owner, server: server, channel: channel, member: member} do
    open_user_channel(owner)
    open_user_channel(member)

    say(owner, channel, "merhaba")

    payload = assert_new_message(member, "merhaba")
    assert payload.channel_id == channel.id
    assert payload.server_id == server.id
    assert payload.channel_name == channel.name
    refute_new_message(owner)
  end

  test "doesn't reach someone outside the server", %{owner: owner, channel: channel} do
    stranger = user_fixture()
    open_user_channel(stranger)

    say(owner, channel, "gizli")

    refute_new_message(stranger)
  end

  test "reaches someone who joined the server after opening Zircle",
       %{owner: owner, server: server, channel: channel} do
    newcomer = user_fixture()
    open_user_channel(newcomer)

    add_member_fixture(server, newcomer)
    say(owner, channel, "hoş geldin")

    assert_new_message(newcomer, "hoş geldin")
  end

  test "reaches the owner of a server created after opening Zircle", %{member: member} do
    open_user_channel(member)
    {:ok, new_server} = Servers.create_server(%{"name" => "yeni"}, member.id)
    new_channel = default_channel(new_server)
    other = user_fixture()
    add_member_fixture(new_server, other)

    say(other, new_channel, "selam")

    assert_new_message(member, "selam")
  end

  test "stops reaching a member who was kicked, or left",
       %{owner: owner, server: server, channel: channel, member: member} do
    leaver = user_fixture()
    add_member_fixture(server, leaver)
    open_user_channel(member)
    open_user_channel(leaver)

    {:ok, _} = Servers.kick_member(server.id, member.id)
    :ok = leave(server, leaver)
    say(owner, channel, "artık yoksunuz")

    refute_new_message(member)
    refute_new_message(leaver)
  end

  test "stops when the server is deleted, and the user channel stays open",
       %{owner: owner, server: server, member: member} do
    socket = open_user_channel(member)

    {:ok, _} = Servers.delete_server(server)

    assert Process.alive?(socket.channel_pid)
    _ = owner
  end

  defp leave(server, user) do
    case Servers.leave_server(server.id, user.id) do
      {:ok, _} -> :ok
      :ok -> :ok
    end
  end
end
