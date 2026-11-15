defmodule BackendWeb.ModeratorRoleTest do
  @moduledoc """
  Server moderators: the owner can promote members, and moderators can
  kick, ban, unban and delete messages — but only for regular members,
  never the owner or another moderator — while server/channel/invite
  settings stay owner-only.
  """
  use BackendWeb.ConnCase, async: true

  alias Backend.{Chat, Servers}

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    mod = user_fixture()
    member = user_fixture()
    other = user_fixture()
    for u <- [mod, member, other], do: add_member_fixture(server, u)

    %{owner: owner, server: server, mod: mod, member: member, other: other}
  end

  defp as(user) do
    n = System.unique_integer([:positive])

    %{build_conn() | remote_ip: {198, 55, rem(div(n, 250), 250), rem(n, 250) + 1}}
    |> put_req_header("authorization", "Bearer #{token_for(user)}")
  end

  defp set_role(actor, server, target, role) do
    patch(as(actor), ~p"/api/servers/#{server.id}/members/#{target.id}", %{"role" => role})
  end

  defp promote(ctx), do: set_role(ctx.owner, ctx.server, ctx.mod, "moderator")

  describe "assigning the role" do
    test "the owner promotes and demotes a member", ctx do
      assert %{"user_id" => _, "role" => "moderator"} = json_response(promote(ctx), 200)
      assert Servers.role_of(ctx.server.id, ctx.mod.id) == "moderator"

      assert json_response(set_role(ctx.owner, ctx.server, ctx.mod, "member"), 200)
      assert Servers.role_of(ctx.server.id, ctx.mod.id) == "member"
    end

    test "the change is announced to the server and to the member", ctx do
      BackendWeb.Endpoint.subscribe("user:#{ctx.mod.id}")
      BackendWeb.Endpoint.subscribe("server:#{ctx.server.id}")
      mod_id = ctx.mod.id

      promote(ctx)

      assert_receive %Phoenix.Socket.Broadcast{
        topic: "user:" <> _,
        event: "member_role_updated",
        payload: %{user_id: ^mod_id, role: "moderator"}
      }

      assert_receive %Phoenix.Socket.Broadcast{
        topic: "server:" <> _,
        event: "member_role_updated"
      }
    end

    test "only the owner can change roles, and the owner's own role can't change", ctx do
      promote(ctx)

      assert json_response(set_role(ctx.mod, ctx.server, ctx.member, "moderator"), 403)
      assert json_response(set_role(ctx.member, ctx.server, ctx.other, "moderator"), 403)
      assert json_response(set_role(ctx.owner, ctx.server, ctx.owner, "member"), 422)
      assert json_response(set_role(ctx.owner, ctx.server, ctx.member, "owner"), 422)
      assert json_response(set_role(ctx.owner, ctx.server, ctx.member, "admin"), 422)
    end

    test "a non-member can't be given a role", ctx do
      stranger = user_fixture()
      assert json_response(set_role(ctx.owner, ctx.server, stranger, "moderator"), 404)
    end

    test "the server list tells each user their own role", ctx do
      promote(ctx)

      [mine] = json_response(get(as(ctx.mod), ~p"/api/servers"), 200)
      assert mine["my_role"] == "moderator"

      [owners] = json_response(get(as(ctx.owner), ~p"/api/servers"), 200)
      assert owners["my_role"] == "owner"
    end
  end

  describe "what a moderator can do" do
    setup ctx do
      promote(ctx)
      :ok
    end

    test "kick a regular member", ctx do
      conn = delete(as(ctx.mod), ~p"/api/servers/#{ctx.server.id}/members/#{ctx.member.id}")
      assert response(conn, 204)
      refute Servers.member?(ctx.server.id, ctx.member.id)
    end

    test "ban and unban a regular member, and see the ban list", ctx do
      ban =
        post(as(ctx.mod), ~p"/api/servers/#{ctx.server.id}/bans", %{"user_id" => ctx.member.id})

      assert json_response(ban, 201)

      assert [_] = json_response(get(as(ctx.mod), ~p"/api/servers/#{ctx.server.id}/bans"), 200)

      unban = delete(as(ctx.mod), ~p"/api/servers/#{ctx.server.id}/bans/#{ctx.member.id}")
      assert response(unban, 204)
    end

    test "delete another member's message", ctx do
      channel = default_channel(ctx.server)

      {:ok, message} =
        Chat.create_message(%{content: "spam", user_id: ctx.member.id, channel_id: channel.id})

      assert {:ok, %{deleted_at: %DateTime{}}} =
               Chat.delete_message(message.id, %{user_id: ctx.mod.id, channel_id: channel.id})
    end
  end

  describe "what a moderator can't do" do
    setup ctx do
      promote(ctx)
      set_role(ctx.owner, ctx.server, ctx.other, "moderator")
      :ok
    end

    test "kick or ban the owner or another moderator", ctx do
      for target <- [ctx.owner, ctx.other] do
        kick = delete(as(ctx.mod), ~p"/api/servers/#{ctx.server.id}/members/#{target.id}")
        assert kick.status in [403, 422]

        ban = post(as(ctx.mod), ~p"/api/servers/#{ctx.server.id}/bans", %{"user_id" => target.id})
        assert ban.status in [403, 422]
        assert Servers.member?(ctx.server.id, target.id)
      end
    end

    test "delete the owner's or another moderator's message", ctx do
      channel = default_channel(ctx.server)

      for author <- [ctx.owner, ctx.other] do
        {:ok, message} =
          Chat.create_message(%{content: "kalsın", user_id: author.id, channel_id: channel.id})

        assert {:error, :not_authorized} =
                 Chat.delete_message(message.id, %{user_id: ctx.mod.id, channel_id: channel.id})
      end
    end

    test "change server settings, channels or invites", ctx do
      assert json_response(
               put(as(ctx.mod), ~p"/api/servers/#{ctx.server.id}", %{"name" => "x"}),
               403
             )

      assert json_response(
               post(as(ctx.mod), ~p"/api/servers/#{ctx.server.id}/channels", %{"name" => "x"}),
               403
             )

      # Any member may create an invite; listing and revoking them stays the owner's.
      assert json_response(get(as(ctx.mod), ~p"/api/servers/#{ctx.server.id}/invites"), 403)
    end
  end

  test "a regular member can't kick or ban anyone", ctx do
    kick = delete(as(ctx.member), ~p"/api/servers/#{ctx.server.id}/members/#{ctx.other.id}")
    assert kick.status == 403

    ban =
      post(as(ctx.member), ~p"/api/servers/#{ctx.server.id}/bans", %{"user_id" => ctx.other.id})

    assert ban.status == 403
  end

  test "a demoted moderator loses the powers again", ctx do
    promote(ctx)
    set_role(ctx.owner, ctx.server, ctx.mod, "member")

    kick = delete(as(ctx.mod), ~p"/api/servers/#{ctx.server.id}/members/#{ctx.member.id}")
    assert kick.status == 403
  end
end
