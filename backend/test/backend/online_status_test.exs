defmodule Backend.OnlineStatusTest do
  @moduledoc """
  Online/offline used to be a `users.status` column written when a user's
  socket joined or left. A socket that died without running `terminate/2`
  — every one of them on a deploy or crash — left its user "online" in the
  database forever. Status now comes from Presence on the user's personal
  "user:<id>" topic, which drops a process the moment it dies.
  """
  use Backend.DataCase, async: false

  alias Backend.{Accounts, DirectMessages, Friends, Presence, Repo, Servers}

  # Stands in for a connected socket: a process tracked on the user's
  # personal topic, like BackendWeb.UserChannel does.
  defp connect(user) do
    test = self()

    pid =
      spawn(fn ->
        {:ok, _} = Presence.track(self(), "user:#{user.id}", user.id, %{})
        send(test, :tracked)

        receive do
          :disconnect -> :ok
        end
      end)

    assert_receive :tracked
    pid
  end

  defp disconnect(pid) do
    ref = Process.monitor(pid)
    send(pid, :disconnect)
    assert_receive {:DOWN, ^ref, :process, ^pid, _}
    # Presence untracks a dead process asynchronously.
    eventually(fn -> true end)
  end

  defp eventually(fun, attempts \\ 50) do
    if fun.() or attempts == 0, do: :ok, else: Process.sleep(10) && eventually(fun, attempts - 1)
  end

  setup do
    owner = user_fixture()
    friend = user_fixture()
    server = server_fixture(owner)
    add_member_fixture(server, friend)
    room = dm_room_fixture(owner, friend)

    %{owner: owner, friend: friend, server: server, room: room}
  end

  defp member_status(server, user) do
    server.id
    |> Servers.list_members()
    |> Enum.find(&(&1.user_id == user.id))
    |> Map.fetch!(:status)
  end

  test "a connected user is online everywhere status is shown", ctx do
    pid = connect(ctx.friend)

    assert Accounts.online?(ctx.friend.id)
    assert member_status(ctx.server, ctx.friend) == "online"
    assert [%{user_status: "online"}] = Friends.list_friendships_for_user(ctx.owner.id)

    assert DirectMessages.to_view(Repo.preload(ctx.room, [:user_one, :user_two]), ctx.owner.id).user_status ==
             "online"

    disconnect(pid)
  end

  test "a stale \"online\" left in the database by a crashed socket is ignored", ctx do
    {:ok, _} = ctx.friend |> Ecto.Changeset.change(status: "online") |> Repo.update()

    refute Accounts.online?(ctx.friend.id)
    assert member_status(ctx.server, ctx.friend) == "offline"
    assert [%{user_status: "offline"}] = Friends.list_friendships_for_user(ctx.owner.id)
  end

  test "a user whose connection goes away is offline again", ctx do
    pid = connect(ctx.friend)
    assert Accounts.online?(ctx.friend.id)

    disconnect(pid)

    eventually(fn -> not Accounts.online?(ctx.friend.id) end)
    refute Accounts.online?(ctx.friend.id)
    assert member_status(ctx.server, ctx.friend) == "offline"
  end
end
