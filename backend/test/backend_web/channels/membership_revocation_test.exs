defmodule BackendWeb.MembershipRevocationTest do
  @moduledoc """
  Losing a server membership (kicked, left, account deleted, server
  deleted) must also end every server-scoped channel process that user
  already had open — not just reject their *next* join. Before this, a
  kicked member's live "chat:<id>" process kept accepting "shout" (it
  never re-checks membership after join) and their "voice:<id>" presence
  kept them in the call, relying entirely on their own client choosing to
  leave after the "member_kicked" notification.
  """
  use BackendWeb.ChannelCase, async: true

  alias Backend.{Accounts, Chat, Servers}

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    channel = default_channel(server)
    member = user_fixture()
    add_member_fixture(server, member)

    %{owner: owner, server: server, channel: channel, member: member}
  end

  # Joins `topic` as `user` and monitors the resulting channel process
  # right away — before whatever revokes access runs, so a process that
  # dies fast still reports its real exit reason instead of `:noproc`.
  # Unlinked because Phoenix.ChannelTest links the channel to the test
  # process, and these tests expect it to exit with a non-:normal
  # {:shutdown, _} reason — see Phoenix.ChannelTest's "Leave and close".
  defp join!(user, topic) do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(user)})
    {:ok, _reply, joined} = subscribe_and_join(socket, topic, %{})
    Process.unlink(joined.channel_pid)
    %{socket: joined, pid: joined.channel_pid, ref: Process.monitor(joined.channel_pid)}
  end

  defp assert_revoked(%{pid: pid, ref: ref}, server_id) do
    assert_receive {:DOWN, ^ref, :process, ^pid, {:shutdown, :membership_revoked}}
    assert_push "access_revoked", %{server_id: ^server_id}
  end

  # A chat channel that still answers a "shout" with :ok is open and
  # working — and since the process handles its mailbox in order, any
  # revocation broadcast that reached it earlier would already have
  # stopped it before this reply could come back.
  defp assert_still_open(%{socket: socket, pid: pid, ref: ref}) do
    reply_ref = push(socket, "shout", %{"content" => "devam"})
    assert_reply reply_ref, :ok
    refute_received {:DOWN, ^ref, :process, ^pid, _reason}
  end

  describe "kick_member/2" do
    test "closes the kicked member's open chat, voice and server channels", %{
      server: server,
      channel: channel,
      member: member
    } do
      chat = join!(member, "chat:#{channel.id}")
      voice = join!(member, "voice:#{channel.id}")
      server_topic = join!(member, "server:#{server.id}")

      {:ok, _} = Servers.kick_member(server.id, member.id)

      server_id = server.id
      assert_revoked(chat, server_id)
      assert_revoked(voice, server_id)
      assert_revoked(server_topic, server_id)
    end

    test "a kicked member's chat process no longer accepts messages", %{
      server: server,
      channel: channel,
      member: member
    } do
      chat = join!(member, "chat:#{channel.id}")
      {:ok, _} = Servers.kick_member(server.id, member.id)
      assert_revoked(chat, server.id)

      push(chat.socket, "shout", %{"content" => "hâlâ buradayım"})
      refute_broadcast "shout", %{content: "hâlâ buradayım"}

      assert [] = Chat.list_messages(channel.id)
    end

    test "drops the kicked member from the voice room's presence for the remaining peers", %{
      owner: owner,
      server: server,
      channel: channel,
      member: member
    } do
      _owner_voice = join!(owner, "voice:#{channel.id}")
      member_voice = join!(member, "voice:#{channel.id}")
      member_id = member.id

      {:ok, _} = Servers.kick_member(server.id, member.id)
      assert_revoked(member_voice, server.id)

      assert_broadcast "presence_diff", %{leaves: %{^member_id => _}}
    end

    test "leaves every other member's channels open and working", %{
      owner: owner,
      server: server,
      channel: channel,
      member: member
    } do
      owner_chat = join!(owner, "chat:#{channel.id}")
      member_chat = join!(member, "chat:#{channel.id}")

      {:ok, _} = Servers.kick_member(server.id, member.id)
      assert_revoked(member_chat, server.id)

      assert_still_open(owner_chat)
    end

    test "only affects the server the member was kicked from", %{
      owner: owner,
      server: server,
      member: member
    } do
      other_server = server_fixture(owner, %{"name" => "Diğer"})
      add_member_fixture(other_server, member)
      other_chat = join!(member, "chat:#{default_channel(other_server).id}")
      kicked_chat = join!(member, "chat:#{default_channel(server).id}")

      {:ok, _} = Servers.kick_member(server.id, member.id)
      assert_revoked(kicked_chat, server.id)

      assert_still_open(other_chat)
    end
  end

  test "leave_server/2 closes the leaving member's open channels", %{
    server: server,
    channel: channel,
    member: member
  } do
    chat = join!(member, "chat:#{channel.id}")

    {:ok, _} = Servers.leave_server(server.id, member.id)

    assert_revoked(chat, server.id)
  end

  test "Accounts.delete_account/2 closes the deleted user's open channels", %{
    server: server,
    channel: channel,
    member: member
  } do
    chat = join!(member, "chat:#{channel.id}")

    {:ok, _} = Accounts.delete_account(member, "password123")

    assert_revoked(chat, server.id)
  end

  test "delete_server/1 closes every member's open channels", %{
    owner: owner,
    server: server,
    channel: channel,
    member: member
  } do
    owner_chat = join!(owner, "chat:#{channel.id}")
    member_voice = join!(member, "voice:#{channel.id}")

    {:ok, _} = Servers.delete_server(server)

    assert_revoked(owner_chat, server.id)
    assert_revoked(member_voice, server.id)
  end
end
