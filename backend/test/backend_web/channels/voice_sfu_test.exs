defmodule BackendWeb.VoiceSfuTest do
  @moduledoc """
  The voice channel's "sfu_*" events: the Cloudflare Realtime SFU API calls
  a participant needs, proxied with the app secret (see Backend.Sfu), each
  one limited to the caller's own session and, for pulls, to tracks the
  others in the same room have published. Cloudflare is stubbed via
  Req.Test; every request it gets is sent to the test process.
  """
  use BackendWeb.ChannelCase, async: true

  alias Backend.Presence

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    channel = default_channel(server)
    member = user_fixture()
    add_member_fixture(server, member)

    test = self()

    # A fake Cloudflare: new sessions get ids s1, s2, ...; tracks/new answers
    # a publish with an "answer" and a pull with an "offer", echoing tracks.
    Req.Test.stub(Backend.Sfu, fn conn ->
      {:ok, raw, conn} = Plug.Conn.read_body(conn)
      body = if raw == "", do: nil, else: Jason.decode!(raw)
      send(test, {:cloudflare, conn.method, conn.request_path, conn.req_headers, body})

      response =
        cond do
          String.ends_with?(conn.request_path, "/sessions/new") ->
            %{"sessionId" => "s#{System.unique_integer([:positive])}"}

          String.ends_with?(conn.request_path, "/tracks/new") and body["sessionDescription"] ->
            %{
              "requiresImmediateRenegotiation" => false,
              "sessionDescription" => %{"type" => "answer", "sdp" => "answer-sdp"},
              "tracks" => body["tracks"]
            }

          String.ends_with?(conn.request_path, "/tracks/new") ->
            %{
              "requiresImmediateRenegotiation" => true,
              "sessionDescription" => %{"type" => "offer", "sdp" => "offer-sdp"},
              "tracks" =>
                Enum.with_index(body["tracks"], fn t, i -> Map.put(t, "mid", "#{i + 10}") end)
            }

          true ->
            %{}
        end

      Req.Test.json(conn, response)
    end)

    %{owner: owner, member: member, channel: channel}
  end

  defp join_room(user, channel) do
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(user)})
    {:ok, reply, socket} = subscribe_and_join(socket, "voice:#{channel.id}", %{})
    Req.Test.allow(Backend.Sfu, self(), socket.channel_pid)
    {reply, socket}
  end

  defp call(socket, event, payload \\ %{}) do
    ref = push(socket, event, payload)
    assert_reply ref, status, reply
    {status, reply}
  end

  defp start_publishing(user, channel) do
    {_reply, socket} = join_room(user, channel)
    {:ok, %{session_id: session}} = call(socket, "sfu_session")

    {:ok, _} =
      call(socket, "sfu_publish", %{
        "session_description" => %{"type" => "offer", "sdp" => "o"},
        "tracks" => [%{"mid" => "0", "trackName" => "audio"}]
      })

    {socket, session}
  end

  defp meta(channel, user) do
    %{metas: [meta | _]} = Presence.get_by_key("voice:#{channel.id}", user.id)
    meta
  end

  test "the join reply says the room uses the SFU", %{owner: owner, channel: channel} do
    assert {%{sfu: true}, _socket} = join_room(owner, channel)
  end

  test "a session is created once, with the app secret, and announced in presence",
       %{owner: owner, channel: channel} do
    {_reply, socket} = join_room(owner, channel)

    assert {:ok, %{session_id: session}} = call(socket, "sfu_session")
    assert {:ok, %{session_id: ^session}} = call(socket, "sfu_session")

    assert_received {:cloudflare, "POST", "/v1/apps/test-app/sessions/new", headers, nil}
    assert {"authorization", "Bearer test-secret"} in headers
    refute_received {:cloudflare, "POST", _, _, _}

    assert %{sfu_session: ^session, sfu_tracks: []} = meta(channel, owner)
  end

  test "publishing forwards the offer to the caller's own session and announces the track",
       %{owner: owner, channel: channel} do
    {_socket, session} = start_publishing(owner, channel)

    path = "/v1/apps/test-app/sessions/#{session}/tracks/new"
    assert_received {:cloudflare, "POST", ^path, _, body}

    assert body == %{
             "sessionDescription" => %{"type" => "offer", "sdp" => "o"},
             "tracks" => [%{"location" => "local", "mid" => "0", "trackName" => "audio"}]
           }

    assert meta(channel, owner).sfu_tracks == ["audio"]
  end

  test "only the known track names can be published", %{owner: owner, channel: channel} do
    {_reply, socket} = join_room(owner, channel)
    {:ok, _} = call(socket, "sfu_session")

    assert {:error, %{reason: "invalid_tracks"}} =
             call(socket, "sfu_publish", %{
               "session_description" => %{"type" => "offer", "sdp" => "o"},
               "tracks" => [%{"mid" => "0", "trackName" => "anything"}]
             })
  end

  test "pulling names a person in the room; the server fills in their session",
       %{owner: owner, member: member, channel: channel} do
    {_owner_socket, owner_session} = start_publishing(owner, channel)
    {_reply, socket} = join_room(member, channel)
    {:ok, %{session_id: member_session}} = call(socket, "sfu_session")

    assert {:ok, reply} =
             call(socket, "sfu_pull", %{
               "tracks" => [%{"user_id" => owner.id, "trackName" => "audio"}]
             })

    assert %{"tracks" => [%{"user_id" => owner_id, "mid" => "10"}]} = reply
    assert owner_id == owner.id

    path = "/v1/apps/test-app/sessions/#{member_session}/tracks/new"
    assert_received {:cloudflare, "POST", ^path, _, body}

    assert body == %{
             "tracks" => [
               %{"location" => "remote", "sessionId" => owner_session, "trackName" => "audio"}
             ]
           }

    assert {:ok, _} =
             call(socket, "sfu_renegotiate", %{
               "session_description" => %{"type" => "answer", "sdp" => "a"}
             })

    assert_received {:cloudflare, "PUT", renegotiate_path, _, _}
    assert renegotiate_path == "/v1/apps/test-app/sessions/#{member_session}/renegotiate"
  end

  test "can't pull a track nobody here published, someone outside the room, or oneself",
       %{owner: owner, member: member, channel: channel} do
    {owner_socket, _session} = start_publishing(owner, channel)
    {_reply, socket} = join_room(member, channel)
    {:ok, _} = call(socket, "sfu_session")
    stranger = user_fixture()

    for track <- [
          %{"user_id" => owner.id, "trackName" => "screen"},
          %{"user_id" => stranger.id, "trackName" => "audio"},
          %{"user_id" => member.id, "trackName" => "audio"}
        ] do
      assert {:error, %{reason: "invalid_tracks"}} =
               call(socket, "sfu_pull", %{"tracks" => [track]})
    end

    assert {:error, %{reason: "invalid_tracks"}} =
             call(owner_socket, "sfu_pull", %{
               "tracks" => [%{"user_id" => owner.id, "trackName" => "audio"}]
             })
  end

  test "closing tracks stops announcing them", %{owner: owner, channel: channel} do
    {socket, session} = start_publishing(owner, channel)

    {:ok, _} =
      call(socket, "sfu_publish", %{
        "session_description" => %{"type" => "offer", "sdp" => "o2"},
        "tracks" => [%{"mid" => "1", "trackName" => "screen"}]
      })

    assert meta(channel, owner).sfu_tracks == ["audio", "screen"]

    assert {:ok, _} =
             call(socket, "sfu_close", %{
               "mids" => ["1"],
               "session_description" => %{"type" => "offer", "sdp" => "o3"},
               "unpublish" => ["screen"]
             })

    assert_received {:cloudflare, "PUT", path, _,
                     %{"force" => false, "tracks" => [%{"mid" => "1"}]}}

    assert path == "/v1/apps/test-app/sessions/#{session}/tracks/close"
    assert meta(channel, owner).sfu_tracks == ["audio"]
  end

  test "nothing but creating a session works before there is one", %{
    owner: owner,
    channel: channel
  } do
    {_reply, socket} = join_room(owner, channel)

    assert {:error, %{reason: "no_session"}} =
             call(socket, "sfu_renegotiate", %{"session_description" => %{}})
  end
end
