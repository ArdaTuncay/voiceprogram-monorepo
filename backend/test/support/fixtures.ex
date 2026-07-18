defmodule Backend.Fixtures do
  @moduledoc """
  Shared test data builders — imported by `Backend.DataCase` and
  `BackendWeb.ChannelCase` so every test (context or channel) can reach for
  the same helpers instead of hand-rolling users/servers/channels per file.
  """

  alias Backend.{Accounts, Chat, DirectMessages, Friends, Servers}

  @doc "Creates a user with a unique username/email. Pass attrs to override."
  def user_fixture(attrs \\ %{}) do
    unique = System.unique_integer([:positive])

    attrs =
      Enum.into(attrs, %{
        "username" => "user#{unique}",
        "email" => "user#{unique}@example.com",
        "password" => "password123"
      })

    {:ok, user} = Accounts.create_user(attrs)
    user
  end

  @doc "Signs a valid auth token for the given user, for use in socket connect params."
  def token_for(user), do: Accounts.generate_user_token(user)

  @doc "Creates a server owned by `owner`, with its default \"genel\" text channel."
  def server_fixture(owner, attrs \\ %{}) do
    unique = System.unique_integer([:positive])
    attrs = Enum.into(attrs, %{"name" => "Server #{unique}"})
    {:ok, server} = Servers.create_server(attrs, owner.id)
    server
  end

  @doc "Returns the server's default \"genel\" text channel (created by server_fixture/2)."
  def default_channel(server) do
    server.id |> Chat.list_channels_for_server() |> hd()
  end

  @doc """
  Adds `user` as a member of `server` via the real invite-accept flow (no
  direct "insert a membership row" shortcut — this exercises the same path
  production traffic does).
  """
  def add_member_fixture(server, user) do
    {:ok, invite} = Servers.create_invite(server.id, server.owner_id)
    {:ok, _server} = Servers.accept_invite(invite.code, user.id)
    :ok
  end

  @doc "Makes `a` and `b` accepted friends (send_request + accept_request)."
  def befriend_fixture(a, b) do
    {:ok, friendship} = Friends.send_request(a.id, %{"username" => b.username})
    {:ok, _} = Friends.accept_request(b.id, friendship.id)
    :ok
  end

  @doc "Befriends `a` and `b` (if not already) and opens/returns their DM room."
  def dm_room_fixture(a, b) do
    befriend_fixture(a, b)
    {:ok, room} = DirectMessages.open_room(a.id, %{"user_id" => b.id})
    room
  end
end
