defmodule BackendWeb.AvatarTest do
  @moduledoc """
  Profile pictures and server icons. Both are images uploaded through the
  normal `POST /api/upload` first; these endpoints only point the user or
  server at one, and only at a file our own upload storage produced (an
  arbitrary URL would turn every viewer's browser into a tracker).
  """
  use BackendWeb.ConnCase, async: true

  alias Backend.{Accounts, Chat, DirectMessages, Servers}

  @avatar "/uploads/AbCdEfGhIjKlMnOpQrStUv.png"
  @icon "/uploads/ZyXwVuTsRqPoNmLkJiHgFe.webp"

  defp as(user) do
    n = System.unique_integer([:positive])

    %{build_conn() | remote_ip: {198, 59, rem(div(n, 250), 250), rem(n, 250) + 1}}
    |> put_req_header("authorization", "Bearer #{token_for(user)}")
  end

  defp set_avatar(user, url), do: patch(as(user), ~p"/api/account/avatar", %{"avatar_url" => url})

  describe "profile picture" do
    test "set and then removed" do
      user = user_fixture()

      assert %{"avatar_url" => @avatar, "id" => _} = json_response(set_avatar(user, @avatar), 200)
      assert Accounts.get_user(user.id).avatar_url == @avatar

      assert %{"avatar_url" => nil} = json_response(set_avatar(user, nil), 200)
      assert Accounts.get_user(user.id).avatar_url == nil
    end

    test "only our own uploaded images are accepted" do
      user = user_fixture()

      for url <- ["https://evil.example/pixel.png", "/uploads/../secret.png", "/uploads/x.svg"] do
        assert json_response(set_avatar(user, url), 422)
      end
    end

    test "comes back on login" do
      user = verified_user_fixture()
      set_avatar(user, @avatar)

      conn =
        post(build_conn(), ~p"/api/users/login", %{
          "email" => user.email,
          "password" => "password123"
        })

      assert %{"avatar_url" => @avatar} = json_response(conn, 200)
    end

    test "travels with messages, members, DM rooms and friends" do
      owner = user_fixture()
      other = user_fixture()
      server = server_fixture(owner)
      add_member_fixture(server, other)
      set_avatar(other, @avatar)

      channel = default_channel(server)

      {:ok, _} =
        Chat.create_message(%{content: "selam", user_id: other.id, channel_id: channel.id})

      [message] =
        json_response(
          get(as(owner), ~p"/api/servers/#{server.id}/channels/#{channel.id}/messages"),
          200
        )["messages"]

      assert message["avatar_url"] == @avatar

      members = json_response(get(as(owner), ~p"/api/servers/#{server.id}/members"), 200)
      assert Enum.find(members, &(&1["user_id"] == other.id))["avatar_url"] == @avatar

      room = dm_room_fixture(owner, other)

      {:ok, _} =
        DirectMessages.create_message(%{content: "dm", user_id: other.id, dm_room_id: room.id})

      [room_view] = json_response(get(as(owner), ~p"/api/dms"), 200)
      assert room_view["avatar_url"] == @avatar

      [dm] = json_response(get(as(owner), ~p"/api/dms/#{room.id}/messages"), 200)["messages"]
      assert dm["avatar_url"] == @avatar

      [friend] = json_response(get(as(owner), ~p"/api/friends"), 200)
      assert friend["avatar_url"] == @avatar
    end

    test "is dropped when the account is deleted" do
      user = user_fixture()
      set_avatar(user, @avatar)

      {:ok, _} = Accounts.delete_account(Accounts.get_user(user.id), "password123")
      assert Accounts.get_user(user.id).avatar_url == nil
    end
  end

  describe "server icon" do
    setup do
      owner = user_fixture()
      server = server_fixture(owner)
      %{owner: owner, server: server}
    end

    defp set_icon(user, server, url),
      do: put(as(user), ~p"/api/servers/#{server.id}/icon", %{"icon_url" => url})

    test "the owner sets and removes it, and members are told live", %{
      owner: owner,
      server: server
    } do
      BackendWeb.Endpoint.subscribe("server:#{server.id}")

      assert %{"icon_url" => @icon} = json_response(set_icon(owner, server, @icon), 200)

      assert_receive %Phoenix.Socket.Broadcast{
        event: "server_updated",
        payload: %{icon_url: @icon, name: _}
      }

      [listed] = json_response(get(as(owner), ~p"/api/servers"), 200)
      assert listed["icon_url"] == @icon

      assert %{"icon_url" => nil} = json_response(set_icon(owner, server, nil), 200)
    end

    test "nobody else can change it, and foreign URLs are refused", %{
      owner: owner,
      server: server
    } do
      member = user_fixture()
      add_member_fixture(server, member)
      {:ok, _} = Servers.set_member_role(server.id, member.id, "moderator")

      assert json_response(set_icon(member, server, @icon), 403)
      assert json_response(set_icon(owner, server, "https://evil.example/i.png"), 422)
    end
  end
end
