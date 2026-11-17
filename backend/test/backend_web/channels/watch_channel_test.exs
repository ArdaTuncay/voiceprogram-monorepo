defmodule BackendWeb.WatchChannelTest do
  use BackendWeb.ChannelCase, async: true

  alias Backend.Servers

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    {:ok, voice} = Servers.create_channel(server.id, %{"name" => "ses", "type" => "voice"})
    member = user_fixture()
    add_member_fixture(server, member)

    %{owner: owner, server: server, voice: voice, member: member}
  end

  defp connect!(user) do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(user)})
    socket
  end

  defp join_voice!(socket, voice) do
    {:ok, _, voice_socket} = subscribe_and_join(socket, "voice:#{voice.id}", %{})
    voice_socket
  end

  # In the voice room, then in its watch party.
  defp join_watch!(user, voice) do
    socket = connect!(user)
    join_voice!(socket, voice)
    {:ok, reply, watch} = subscribe_and_join(socket, "watch:#{voice.id}", %{})
    {reply, watch}
  end

  test "joining needs you to be in the voice room", %{owner: owner, voice: voice} do
    assert {:error, %{reason: "not_in_voice"}} =
             subscribe_and_join(connect!(owner), "watch:#{voice.id}", %{})
  end

  test "a text channel has no watch party", %{owner: owner, server: server} do
    text = default_channel(server)

    assert {:error, %{reason: "channel not found"}} =
             subscribe_and_join(connect!(owner), "watch:#{text.id}", %{})
  end

  test "a non-member is refused", %{voice: voice} do
    assert {:error, %{reason: "not authorized"}} =
             subscribe_and_join(connect!(user_fixture()), "watch:#{voice.id}", %{})
  end

  test "join replies with the current state and the server clock", %{owner: owner, voice: voice} do
    {reply, _watch} = join_watch!(owner, voice)

    assert %{state: %{rev: 0, video: nil}, server_time: server_time} = reply
    assert_in_delta server_time, System.system_time(:millisecond), 1_000
  end

  test "one participant's load and play reach the other", %{
    owner: owner,
    member: member,
    voice: voice
  } do
    {_, owner_watch} = join_watch!(owner, voice)
    {_, _member_watch} = join_watch!(member, voice)
    owner_id = owner.id

    ref = push(owner_watch, "load", %{"url" => "https://youtu.be/dQw4w9WgXcQ"})
    assert_reply ref, :ok, %{rev: 1, video: %{source: %{kind: "youtube", id: "dQw4w9WgXcQ"}}}
    assert_broadcast "state", %{rev: 1}

    ref = push(owner_watch, "play", %{"position" => 3})
    assert_reply ref, :ok, %{rev: 2}

    assert_broadcast "state", %{
      rev: 2,
      video: %{playing: true, position: 3.0, updated_by: ^owner_id}
    }
  end

  test "a late joiner sees what's already playing", %{owner: owner, member: member, voice: voice} do
    {_, owner_watch} = join_watch!(owner, voice)
    ref = push(owner_watch, "load", %{"url" => "https://cdn.example.com/a.mp4"})
    assert_reply ref, :ok, _
    ref = push(owner_watch, "play", %{"position" => 10})
    assert_reply ref, :ok, _

    {reply, _} = join_watch!(member, voice)

    assert %{state: %{rev: 2, video: %{playing: true, source: %{kind: "url"}}}} = reply
  end

  test "bad input is refused", %{owner: owner, voice: voice} do
    {_, watch} = join_watch!(owner, voice)

    ref = push(watch, "load", %{"url" => "javascript:alert(1)"})
    assert_reply ref, :error, %{reason: "invalid_url"}

    ref = push(watch, "play", %{"position" => 1})
    assert_reply ref, :error, %{reason: "no_video"}

    ref = push(watch, "play", %{"position" => "1"})
    assert_reply ref, :error, %{reason: "invalid_payload"}

    ref = push(watch, "eject", %{})
    assert_reply ref, :error, %{reason: "invalid_payload"}
  end

  test "ping replies with the server clock", %{owner: owner, voice: voice} do
    {_, watch} = join_watch!(owner, voice)
    ref = push(watch, "ping", %{})
    assert_reply ref, :ok, %{server_time: server_time}
    assert is_integer(server_time)
  end

  test "a kicked member's watch channel closes", %{
    server: server,
    member: member,
    voice: voice
  } do
    {_, watch} = join_watch!(member, voice)
    Process.unlink(watch.channel_pid)
    ref = Process.monitor(watch.channel_pid)
    server_id = server.id

    Servers.kick_member(server.id, member.id)

    assert_receive {:DOWN, ^ref, :process, _, {:shutdown, :membership_revoked}}
    assert_push "access_revoked", %{server_id: ^server_id}
  end
end
