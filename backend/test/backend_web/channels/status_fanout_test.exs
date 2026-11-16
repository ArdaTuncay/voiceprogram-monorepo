defmodule BackendWeb.StatusFanoutTest do
  @moduledoc """
  "member_status_changed" on each co-member's personal "user:<id>" channel —
  what keeps the online list live when someone opens or closes Zircle.
  Delivered through each server's shared notifications topic (see
  `BackendWeb.UserChannel`), so a user who shares several servers with
  someone must still hear about it only once.
  """
  use BackendWeb.ChannelCase, async: true

  alias Backend.Servers

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    member = user_fixture()
    add_member_fixture(server, member)

    %{owner: owner, server: server, member: member}
  end

  # Opens `user`'s personal channel, as every open Zircle tab does.
  defp open_user_channel(user) do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(user)})
    {:ok, _reply, socket} = subscribe_and_join(socket, "user:#{user.id}", %{})
    socket
  end

  # Pushes go to the test process, which is every socket's transport here,
  # so whose channel pushed it is told apart by the topic.
  defp assert_status(to, about, status) do
    topic = "user:#{to.id}"
    about_id = about.id

    assert_receive %Phoenix.Socket.Message{
      topic: ^topic,
      event: "member_status_changed",
      payload: %{user_id: ^about_id, status: ^status} = payload
    }

    payload
  end

  defp refute_status(to, about) do
    topic = "user:#{to.id}"
    about_id = about.id

    refute_receive %Phoenix.Socket.Message{
                     topic: ^topic,
                     event: "member_status_changed",
                     payload: %{user_id: ^about_id}
                   },
                   100
  end

  test "a co-member hears that someone came online, and went offline",
       %{owner: owner, member: member} do
    open_user_channel(member)
    owner_socket = open_user_channel(owner)

    payload = assert_status(member, owner, "online")
    assert Map.keys(payload) |> Enum.sort() == [:status, :user_id]

    Process.unlink(owner_socket.channel_pid)
    close(owner_socket)

    assert_status(member, owner, "offline")
  end

  test "goes out once per server, on its notifications topic, not once per member",
       %{owner: owner, server: server} do
    owner_id = owner.id
    :ok = Phoenix.PubSub.subscribe(Backend.PubSub, Servers.notifications_topic(server.id))
    :ok = Phoenix.PubSub.subscribe(Backend.PubSub, "user:#{owner.id}")

    open_user_channel(owner)

    assert_receive {:member_status_changed, %{user_id: ^owner_id, status: "online"}}

    refute_receive %Phoenix.Socket.Broadcast{event: "member_status_changed"}, 100
  end

  test "someone outside the server hears nothing", %{owner: owner} do
    stranger = user_fixture()
    open_user_channel(stranger)

    open_user_channel(owner)

    refute_status(stranger, owner)
  end

  test "nobody hears about their own status", %{owner: owner} do
    open_user_channel(owner)

    refute_status(owner, owner)
  end

  test "sharing several servers still means one notification",
       %{owner: owner, member: member} do
    second = server_fixture(owner)
    add_member_fixture(second, member)
    third = server_fixture(member)
    add_member_fixture(third, owner)

    open_user_channel(member)
    open_user_channel(owner)

    assert_status(member, owner, "online")
    refute_status(member, owner)
  end

  test "a second tab doesn't announce again, closing one of two doesn't go offline",
       %{owner: owner, member: member} do
    open_user_channel(member)
    first = open_user_channel(owner)
    assert_status(member, owner, "online")

    second = open_user_channel(owner)
    refute_status(member, owner)

    Process.unlink(first.channel_pid)
    close(first)
    refute_status(member, owner)

    Process.unlink(second.channel_pid)
    close(second)
    assert_status(member, owner, "offline")
  end

  test "reaches someone who joined the server after opening Zircle", %{owner: owner} do
    newcomer = user_fixture()
    open_user_channel(newcomer)
    server = server_fixture(owner)
    add_member_fixture(server, newcomer)

    open_user_channel(owner)

    assert_status(newcomer, owner, "online")
  end

  test "stops reaching someone who left the only server they shared",
       %{owner: owner, server: server, member: member} do
    open_user_channel(member)
    {:ok, _} = Servers.kick_member(server.id, member.id)

    open_user_channel(owner)

    refute_status(member, owner)
  end
end
