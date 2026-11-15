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

  # The other half of the kick guarantee: an already-joined process is
  # closed server-side (see membership_revocation_test.exs and
  # Servers.revoke_channel_access/2); this covers their NEXT join attempt.
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
