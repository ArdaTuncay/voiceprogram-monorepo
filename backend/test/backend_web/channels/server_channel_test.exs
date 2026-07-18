defmodule BackendWeb.ServerChannelTest do
  use BackendWeb.ChannelCase, async: true

  alias Backend.Servers

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    member = user_fixture()
    add_member_fixture(server, member)
    stranger = user_fixture()

    %{owner: owner, server: server, member: member, stranger: stranger}
  end

  test "connect/3 rejects an invalid token" do
    assert :error = connect(BackendWeb.UserSocket, %{"token" => "not-a-real-token"})
  end

  test "join is rejected for a user who isn't a server member", %{
    server: server,
    stranger: stranger
  } do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(stranger)})

    assert {:error, %{reason: "not authorized"}} =
             subscribe_and_join(socket, "server:#{server.id}", %{})
  end

  test "join is rejected for a nonexistent server id", %{owner: owner} do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})

    assert {:error, %{reason: "server not found"}} =
             subscribe_and_join(socket, "server:#{Ecto.UUID.generate()}", %{})
  end

  test "a member joins successfully", %{owner: owner, server: server} do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})

    assert {:ok, _reply, _socket} = subscribe_and_join(socket, "server:#{server.id}", %{})
  end

  test "channel_created is broadcast once to everyone currently viewing the server",
       %{owner: owner, server: server} do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _reply, _socket} = subscribe_and_join(socket, "server:#{server.id}", %{})

    {:ok, _channel} =
      Servers.create_channel(server.id, %{"name" => "duyurular", "type" => "text"})

    assert_broadcast "channel_created", %{name: "duyurular", server_id: server_id}
    assert server_id == server.id
  end

  # A kicked/left member isn't forcibly evicted from an already-joined
  # "server:<id>" channel process at the backend level today — that
  # topic has no handle_in and never re-checks membership after join. The
  # actually-enforced guarantee (and what production relies on) is that
  # their NEXT join attempt is rejected once Servers.member?/2 says no. The
  # frontend's own removal from the server list (driven by the personal
  # "member_kicked"/"member_left" notification, see UserSocket/UserChannel)
  # is what makes them actually leave the topic in practice.
  test "a kicked member's subsequent join is rejected", %{
    owner: owner,
    server: server,
    member: member
  } do
    {:ok, _} = Servers.kick_member(server.id, member.id)

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(member)})

    assert {:error, %{reason: "not authorized"}} =
             subscribe_and_join(socket, "server:#{server.id}", %{})

    # sanity: the owner is unaffected
    {:ok, owner_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    assert {:ok, _reply, _socket} = subscribe_and_join(owner_socket, "server:#{server.id}", %{})
  end

  test "a member who leaves can no longer rejoin, and member_left reaches the remaining viewer",
       %{owner: owner, server: server, member: member} do
    {:ok, owner_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _reply, _socket} = subscribe_and_join(owner_socket, "server:#{server.id}", %{})

    {:ok, _} = Servers.leave_server(server.id, member.id)

    assert_broadcast "member_left", %{server_id: server_id, user_id: user_id}
    assert server_id == server.id
    assert user_id == member.id

    {:ok, member_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(member)})

    assert {:error, %{reason: "not authorized"}} =
             subscribe_and_join(member_socket, "server:#{server.id}", %{})
  end
end
