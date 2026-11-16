defmodule BackendWeb.PresenceAvatarTest do
  @moduledoc """
  The online list, the voice room and the "who's in this voice room" preview
  all come from Presence, so the profile picture has to ride along in the
  Presence metadata (and in `Chat.voice_occupants/1`) for those places to show
  it instead of initials.
  """
  use BackendWeb.ChannelCase, async: true

  alias Backend.Chat
  alias Backend.Repo

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    channel = default_channel(server)

    owner =
      owner
      |> Ecto.Changeset.change(avatar_url: "/uploads/owner-avatar.png")
      |> Repo.update!()

    %{owner: owner, server: server, channel: channel}
  end

  test "the text channel's presence carries the avatar", %{owner: owner, channel: channel} do
    owner_id = owner.id
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _reply, _socket} = subscribe_and_join(socket, "chat:#{channel.id}", %{})

    assert_push "presence_state", %{^owner_id => %{metas: [meta]}}
    assert meta.avatar_url == "/uploads/owner-avatar.png"
  end

  test "the presence picks up an avatar changed after the socket connected",
       %{owner: owner, channel: channel} do
    owner_id = owner.id
    {:ok, socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})

    owner |> Ecto.Changeset.change(avatar_url: "/uploads/new.png") |> Repo.update!()

    {:ok, _reply, _socket} = subscribe_and_join(socket, "chat:#{channel.id}", %{})

    assert_push "presence_state", %{^owner_id => %{metas: [meta]}}
    assert meta.avatar_url == "/uploads/new.png"
  end

  test "the voice room's occupants carry the avatar, live and over the channel list",
       %{owner: owner, server: server, channel: channel} do
    owner_id = owner.id
    {:ok, server_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _reply, _server_socket} = subscribe_and_join(server_socket, "server:#{server.id}", %{})

    {:ok, voice_socket} = connect(BackendWeb.UserSocket, %{"token" => token_for(owner)})
    {:ok, _reply, _voice_socket} = subscribe_and_join(voice_socket, "voice:#{channel.id}", %{})

    assert_broadcast "voice_presence_updated", %{
      users: [%{user_id: ^owner_id, avatar_url: "/uploads/owner-avatar.png"}]
    }

    assert [%{avatar_url: "/uploads/owner-avatar.png"}] = Chat.voice_occupants(channel.id)
  end
end
