defmodule BackendWeb.BanControllerTest do
  @moduledoc """
  Server bans. Kicking only removed a membership — the kicked user could
  walk straight back in with any invite link. A ban removes them AND keeps
  them out until the owner lifts it.
  """
  use BackendWeb.ConnCase, async: true

  alias Backend.Servers

  setup do
    owner = user_fixture()
    server = server_fixture(owner)
    member = user_fixture()
    add_member_fixture(server, member)
    {:ok, invite} = Servers.create_invite(server.id, owner.id)

    %{owner: owner, server: server, member: member, invite: invite}
  end

  defp as(user) do
    n = System.unique_integer([:positive])

    %{build_conn() | remote_ip: {198, 53, rem(div(n, 250), 250), rem(n, 250) + 1}}
    |> put_req_header("authorization", "Bearer #{token_for(user)}")
  end

  defp ban(actor, server, user_id, reason \\ nil) do
    body =
      if reason, do: %{"user_id" => user_id, "reason" => reason}, else: %{"user_id" => user_id}

    post(as(actor), ~p"/api/servers/#{server.id}/bans", body)
  end

  test "the owner bans a member: they're removed, listed, and can't rejoin by invite", ctx do
    conn = ban(ctx.owner, ctx.server, ctx.member.id, "spam")

    assert %{"user_id" => member_id, "reason" => "spam"} = json_response(conn, 201)
    assert member_id == ctx.member.id
    refute Servers.member?(ctx.server.id, ctx.member.id)

    assert [%{"user_id" => ^member_id, "username" => username, "reason" => "spam"}] =
             json_response(get(as(ctx.owner), ~p"/api/servers/#{ctx.server.id}/bans"), 200)

    assert username == ctx.member.username

    rejoin = post(as(ctx.member), ~p"/api/invites/#{ctx.invite.code}/accept")
    assert json_response(rejoin, 403) == %{"error" => "Bu sunucudan yasaklandınız"}
    refute Servers.member?(ctx.server.id, ctx.member.id)
  end

  test "banning also closes the member's open channels (like a kick)", ctx do
    Servers.subscribe_to_membership(ctx.server.id, ctx.member.id)

    ban(ctx.owner, ctx.server, ctx.member.id)

    server_id = ctx.server.id
    assert_receive {:server_membership_revoked, ^server_id}
  end

  test "the banned user is told, the same way as a kick", ctx do
    BackendWeb.Endpoint.subscribe("user:#{ctx.member.id}")

    ban(ctx.owner, ctx.server, ctx.member.id)

    assert_receive %Phoenix.Socket.Broadcast{event: "member_kicked", payload: %{banned: true}}
  end

  test "lifting the ban lets them join again", ctx do
    ban(ctx.owner, ctx.server, ctx.member.id)

    conn = delete(as(ctx.owner), ~p"/api/servers/#{ctx.server.id}/bans/#{ctx.member.id}")
    assert response(conn, 204)

    rejoin = post(as(ctx.member), ~p"/api/invites/#{ctx.invite.code}/accept")
    assert json_response(rejoin, 200)
    assert Servers.member?(ctx.server.id, ctx.member.id)
  end

  test "a user who isn't a member (yet) can be banned pre-emptively", ctx do
    stranger = user_fixture()

    assert json_response(ban(ctx.owner, ctx.server, stranger.id), 201)

    join = post(as(stranger), ~p"/api/invites/#{ctx.invite.code}/accept")
    assert json_response(join, 403)
  end

  test "banning twice updates the reason instead of failing", ctx do
    ban(ctx.owner, ctx.server, ctx.member.id, "ilk")

    assert %{"reason" => "ikinci"} =
             json_response(ban(ctx.owner, ctx.server, ctx.member.id, "ikinci"), 201)

    assert [%{"reason" => "ikinci"}] =
             json_response(get(as(ctx.owner), ~p"/api/servers/#{ctx.server.id}/bans"), 200)
  end

  test "only the owner can ban, list or unban", ctx do
    other = user_fixture()
    add_member_fixture(ctx.server, other)

    assert json_response(ban(ctx.member, ctx.server, other.id), 403)
    assert json_response(get(as(ctx.member), ~p"/api/servers/#{ctx.server.id}/bans"), 403)

    ban(ctx.owner, ctx.server, other.id)
    unban = delete(as(ctx.member), ~p"/api/servers/#{ctx.server.id}/bans/#{other.id}")
    assert json_response(unban, 403)
    assert Servers.banned?(ctx.server.id, other.id)
  end

  test "the owner can't be banned", ctx do
    assert %{"error" => _} = json_response(ban(ctx.owner, ctx.server, ctx.owner.id), 422)
  end

  test "rejects an unknown user, a malformed id and an over-long reason", ctx do
    assert json_response(ban(ctx.owner, ctx.server, Ecto.UUID.generate()), 404)
    assert json_response(ban(ctx.owner, ctx.server, "not-a-uuid"), 404)

    long = String.duplicate("a", 201)

    assert %{"errors" => %{"reason" => _}} =
             json_response(ban(ctx.owner, ctx.server, ctx.member.id, long), 422)
  end

  test "unbanning someone who isn't banned is a 404", ctx do
    conn = delete(as(ctx.owner), ~p"/api/servers/#{ctx.server.id}/bans/#{ctx.member.id}")
    assert json_response(conn, 404)
  end

  test "bans disappear with the server", ctx do
    ban(ctx.owner, ctx.server, ctx.member.id)
    {:ok, _} = Servers.delete_server(ctx.server)

    refute Servers.banned?(ctx.server.id, ctx.member.id)
  end
end
