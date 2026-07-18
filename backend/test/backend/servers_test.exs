defmodule Backend.ServersTest do
  use Backend.DataCase, async: true

  alias Backend.Servers

  describe "member?/2" do
    test "true for the owner" do
      owner = user_fixture()
      server = server_fixture(owner)

      assert Servers.member?(server.id, owner.id)
    end

    test "true for a user added via invite" do
      owner = user_fixture()
      server = server_fixture(owner)
      member = user_fixture()
      add_member_fixture(server, member)

      assert Servers.member?(server.id, member.id)
    end

    test "false for a user who was never added" do
      owner = user_fixture()
      server = server_fixture(owner)
      stranger = user_fixture()

      refute Servers.member?(server.id, stranger.id)
    end

    test "false after the member leaves" do
      owner = user_fixture()
      server = server_fixture(owner)
      member = user_fixture()
      add_member_fixture(server, member)

      {:ok, _} = Servers.leave_server(server.id, member.id)

      refute Servers.member?(server.id, member.id)
    end

    test "false after the member is kicked" do
      owner = user_fixture()
      server = server_fixture(owner)
      member = user_fixture()
      add_member_fixture(server, member)

      {:ok, _} = Servers.kick_member(server.id, member.id)

      refute Servers.member?(server.id, member.id)
    end
  end

  describe "owner?/2" do
    test "true for the creator" do
      owner = user_fixture()
      server = server_fixture(owner)

      assert Servers.owner?(server.id, owner.id)
    end

    test "false for a regular member" do
      owner = user_fixture()
      server = server_fixture(owner)
      member = user_fixture()
      add_member_fixture(server, member)

      refute Servers.owner?(server.id, member.id)
    end

    test "false for a nonexistent server id" do
      user = user_fixture()

      refute Servers.owner?(Ecto.UUID.generate(), user.id)
    end
  end

  describe "leave_server/2" do
    test "the owner cannot leave their own server" do
      owner = user_fixture()
      server = server_fixture(owner)

      assert {:error, :owner_cannot_leave} = Servers.leave_server(server.id, owner.id)
      assert Servers.member?(server.id, owner.id)
    end

    test "a non-member leaving is a not-found error" do
      owner = user_fixture()
      server = server_fixture(owner)
      stranger = user_fixture()

      assert {:error, :not_found} = Servers.leave_server(server.id, stranger.id)
    end
  end

  describe "kick_member/2" do
    test "kicking a non-member is a not-found error" do
      owner = user_fixture()
      server = server_fixture(owner)
      stranger = user_fixture()

      assert {:error, :not_found} = Servers.kick_member(server.id, stranger.id)
    end
  end
end
