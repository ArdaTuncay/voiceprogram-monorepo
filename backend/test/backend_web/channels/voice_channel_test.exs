defmodule BackendWeb.VoiceChannelTest do
  use BackendWeb.ChannelCase, async: true

  alias Backend.Presence
  alias Ecto.Adapters.SQL.Sandbox

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    channel = default_channel(server)
    member = user_fixture()
    add_member_fixture(server, member)
    stranger = user_fixture()

    %{owner: owner, server: server, channel: channel, member: member, stranger: stranger}
  end

  test "join is rejected for a user who isn't a server member", %{
    channel: channel,
    stranger: stranger
  } do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(stranger)})

    assert {:error, %{reason: "not authorized"}} =
             subscribe_and_join(socket, "voice:#{channel.id}", %{})
  end

  test "a member joins successfully and sees existing peers", %{owner: owner, channel: channel} do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})

    assert {:ok, %{peers: []}, _socket} = subscribe_and_join(socket, "voice:#{channel.id}", %{})
  end

  test "different users can join the same room independently, seeing each other as peers",
       %{owner: owner, member: member, channel: channel} do
    owner_id = owner.id

    {:ok, owner_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})

    assert {:ok, %{peers: []}, _owner_socket} =
             subscribe_and_join(owner_socket, "voice:#{channel.id}", %{})

    {:ok, member_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(member)})

    assert {:ok, %{peers: [^owner_id]}, _member_socket} =
             subscribe_and_join(member_socket, "voice:#{channel.id}", %{})
  end

  test "a second join from the same user while already connected is rejected",
       %{owner: owner, channel: channel} do
    {:ok, socket1} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    assert {:ok, %{peers: []}, _socket1} = subscribe_and_join(socket1, "voice:#{channel.id}", %{})

    {:ok, socket2} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})

    assert {:error, %{reason: "already_connected_elsewhere"}} =
             subscribe_and_join(socket2, "voice:#{channel.id}", %{})
  end

  test "a hard-killed channel process is cleaned up immediately, so a reconnect isn't blocked",
       %{owner: owner, channel: channel} do
    owner_id = owner.id

    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    assert {:ok, %{peers: []}, socket} = subscribe_and_join(socket, "voice:#{channel.id}", %{})

    # Simulates a crashed/network-dropped tab: the transport never sends a
    # clean "leave", the channel process just dies. Phoenix.Tracker links
    # every tracked pid and traps exits (see Phoenix.Tracker.Shard), so
    # cleanup is driven by that link firing on process death — immediate,
    # not a polling/heartbeat interval — which is what makes the reconnect
    # below safe to attempt right away instead of needing to wait out some
    # grace period.
    old_pid = socket.channel_pid
    ref = Process.monitor(old_pid)
    # Phoenix.ChannelTest links the channel process to this test process
    # (via the test's channel supervisor) — without unlinking first, killing
    # it would propagate the exit signal here and fail the test itself
    # rather than the channel process alone.
    Process.unlink(old_pid)
    Process.exit(old_pid, :kill)
    assert_receive {:DOWN, ^ref, :process, ^old_pid, :killed}

    assert_broadcast "presence_diff", %{leaves: %{^owner_id => _}}

    {:ok, socket2} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})

    assert {:ok, %{peers: []}, _socket2} =
             subscribe_and_join(socket2, "voice:#{channel.id}", %{})
  end

  test "join broadcasts voice_presence_updated to the server topic, including the joiner",
       %{owner: owner, server: server, channel: channel} do
    owner_id = owner.id
    channel_id = channel.id

    {:ok, server_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _reply, _server_socket} = subscribe_and_join(server_socket, "server:#{server.id}", %{})

    {:ok, voice_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    assert {:ok, _reply, _voice_socket} = subscribe_and_join(voice_socket, "voice:#{channel.id}", %{})

    assert_broadcast "voice_presence_updated", %{
      channel_id: ^channel_id,
      users: [%{user_id: ^owner_id, username: _}]
    }
  end

  test "a second peer joining broadcasts the full, updated occupant list (not just the newcomer)",
       %{owner: owner, member: member, server: server, channel: channel} do
    owner_id = owner.id
    member_id = member.id
    channel_id = channel.id

    {:ok, server_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _reply, _server_socket} = subscribe_and_join(server_socket, "server:#{server.id}", %{})

    {:ok, owner_voice_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _reply, _owner_voice_socket} =
      subscribe_and_join(owner_voice_socket, "voice:#{channel.id}", %{})

    # The owner's own join broadcast — not what this test is about, just
    # drained so it doesn't get picked up by the assert_broadcast below.
    assert_broadcast "voice_presence_updated", %{channel_id: ^channel_id}

    {:ok, member_voice_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(member)})
    {:ok, _reply, _member_voice_socket} =
      subscribe_and_join(member_voice_socket, "voice:#{channel.id}", %{})

    assert_broadcast "voice_presence_updated", %{channel_id: ^channel_id, users: users}
    assert Enum.sort(Enum.map(users, & &1.user_id)) == Enum.sort([owner_id, member_id])
  end

  test "leaving broadcasts voice_presence_updated with that user removed from the list",
       %{owner: owner, member: member, server: server, channel: channel} do
    owner_id = owner.id
    channel_id = channel.id

    {:ok, server_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _reply, _server_socket} = subscribe_and_join(server_socket, "server:#{server.id}", %{})

    {:ok, owner_voice_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _reply, _owner_voice_socket} =
      subscribe_and_join(owner_voice_socket, "voice:#{channel.id}", %{})

    assert_broadcast "voice_presence_updated", %{channel_id: ^channel_id}

    {:ok, member_voice_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(member)})
    {:ok, _reply, member_voice_socket} =
      subscribe_and_join(member_voice_socket, "voice:#{channel.id}", %{})

    assert_broadcast "voice_presence_updated", %{channel_id: ^channel_id}

    # A graceful leave — `terminate/2` doesn't branch on `reason`, so this
    # exercises the same broadcast a socket close or a crashed channel
    # process would (see terminate/2's own doc comment); `leave/1` is just
    # the reliable, standard way to actually trigger it from a test (unlike
    # `Process.exit(pid, :kill)` — see the "hard-killed channel process"
    # test above — a `:kill` signal bypasses `terminate/2` entirely, so it
    # wouldn't exercise this code path at all). Phoenix.ChannelTest links
    # the channel process to this test process (same as that other test),
    # so it has to be unlinked first — otherwise the process's own
    # `{:shutdown, :left}` exit on leave propagates here and kills the test.
    Process.unlink(member_voice_socket.channel_pid)
    leave(member_voice_socket)

    assert_broadcast "voice_presence_updated", %{
      channel_id: ^channel_id,
      users: [%{user_id: ^owner_id, username: _}]
    }
  end

  test "update_status is rate-limited after 30 updates/min and stops applying past that",
       %{owner: owner, channel: channel} do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _, socket} = subscribe_and_join(socket, "voice:#{channel.id}", %{})

    for _ <- 1..30 do
      push(socket, "update_status", %{"muted" => true, "deafened" => false})
    end

    # 31st: over budget, must be dropped rather than applied.
    push(socket, "update_status", %{"muted" => false, "deafened" => true})

    # `:sys.get_state/1` round-trips through the channel process's mailbox,
    # so by the time it returns every push above has already been handled —
    # there's no reply on this event to synchronize on otherwise.
    :sys.get_state(socket.channel_pid)

    assert %{metas: [%{muted: true, deafened: false}]} = Presence.list(socket)[owner.id]
  end

  test "video_offer/video_answer/ice_candidate share one rate-limit bucket per peer pair",
       %{owner: owner, member: member, channel: channel} do
    {:ok, owner_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _, owner_socket} = subscribe_and_join(owner_socket, "voice:#{channel.id}", %{})

    member_task = spawn_peer("voice:#{channel.id}", member)

    # 50 allowed, split across all three signal types since they share one
    # per-peer-pair bucket.
    for n <- 1..48 do
      push(owner_socket, "ice_candidate", %{"to" => member.id, "candidate" => "c#{n}"})
    end

    push(owner_socket, "video_offer", %{"to" => member.id, "sdp" => "offer"})
    push(owner_socket, "video_answer", %{"to" => member.id, "sdp" => "answer"})

    # 51st signal message for this peer pair: over budget, must not relay.
    push(owner_socket, "ice_candidate", %{"to" => member.id, "candidate" => "blocked"})

    assert Task.await(member_task, 2000) == 50
  end

  test "a different peer pair in the same room has its own signal rate-limit bucket",
       %{owner: owner, server: server, member: member, channel: channel} do
    third = user_fixture()
    add_member_fixture(server, third)

    {:ok, owner_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _, owner_socket} = subscribe_and_join(owner_socket, "voice:#{channel.id}", %{})

    for n <- 1..50 do
      push(owner_socket, "ice_candidate", %{"to" => member.id, "candidate" => "c#{n}"})
    end

    third_task = spawn_peer("voice:#{channel.id}", third)

    # `member`'s bucket for this pair is exhausted, but `third` is a
    # different peer pair and must still be allowed through.
    push(owner_socket, "ice_candidate", %{"to" => third.id, "candidate" => "still allowed"})

    assert Task.await(third_task, 2000) == 1
  end

  test "screen_share_stopped is relayed to other peers in the room, tagged with the sender's user_id",
       %{owner: owner, member: member, channel: channel} do
    owner_id = owner.id
    parent = self()

    {:ok, owner_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _, owner_socket} = subscribe_and_join(owner_socket, "voice:#{channel.id}", %{})

    # Same reasoning as spawn_peer/collect_relayed_signals below: sockets
    # connected directly in this test process would all share this test
    # process as their transport_pid, so broadcast_from! would exclude them
    # too — a separate Task is the only way to see what a *different* peer
    # actually receives.
    task =
      Task.async(fn ->
        {:ok, socket} =
          connect(BackendWeb.UserSocket, %{"token" => token_for(member)}, test_process: parent)

        {:ok, _, _socket} = subscribe_and_join(socket, "voice:#{channel.id}", %{})
        send(parent, :peer_ready)

        receive do
          %Phoenix.Socket.Message{event: "screen_share_stopped", payload: payload} -> payload
        after
          1000 -> :timeout
        end
      end)

    Sandbox.allow(Backend.Repo, self(), task.pid)
    assert_receive :peer_ready, 1000

    push(owner_socket, "screen_share_stopped", %{})

    assert %{user_id: ^owner_id} = Task.await(task, 2000)
  end

  # Joins `topic` as `user` from a *separate* process, so `broadcast_from!`
  # (which excludes only the sender's own transport_pid) actually has
  # someone else to deliver to — every socket connected directly in the
  # test body shares the test process as its transport_pid, so relays would
  # otherwise always appear to be excluded. `Task.async` propagates
  # `$callers` to the task itself, but the *channel* process Phoenix spawns
  # only inherits `$callers = [task_pid]` (see `Phoenix.Channel.Server`), so
  # the DB sandbox connection has to be allowed for `task.pid` explicitly
  # before the task is allowed to proceed into `connect/3` + join.
  defp spawn_peer(topic, user) do
    parent = self()

    task =
      Task.async(fn ->
        receive do
          :go -> :ok
        end

        {:ok, socket} =
          connect(BackendWeb.UserSocket, %{"token" => token_for(user)}, test_process: parent)

        {:ok, _, _socket} = subscribe_and_join(socket, topic, %{})
        send(parent, :peer_ready)
        collect_relayed_signals(user.id, 0)
      end)

    Sandbox.allow(Backend.Repo, self(), task.pid)
    send(task.pid, :go)
    assert_receive :peer_ready, 1000

    task
  end

  # `relay_signal/3` in voice_channel.ex broadcasts to every other
  # subscriber of the room's topic, not just the payload's "to" — the
  # server treats "to" as opaque, client-side-only routing info (see its
  # moduledoc). So a peer connected to a room that's also seeing *other*
  # peers' signal traffic would otherwise pick up that spillover here too;
  # filtering on "to" mirrors what the real frontend does and keeps this
  # count scoped to messages actually addressed to `self_id`.
  defp collect_relayed_signals(self_id, count) do
    receive do
      %Phoenix.Socket.Message{event: event, payload: %{"to" => ^self_id}}
      when event in ["video_offer", "video_answer", "ice_candidate"] ->
        collect_relayed_signals(self_id, count + 1)

      %Phoenix.Socket.Message{event: event}
      when event in ["video_offer", "video_answer", "ice_candidate"] ->
        collect_relayed_signals(self_id, count)
    after
      300 -> count
    end
  end
end
