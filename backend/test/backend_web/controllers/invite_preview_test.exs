defmodule BackendWeb.InvitePreviewTest do
  # The preview has a per-IP rate limit (Hammer's :ets backend is shared,
  # not sandboxed), so this runs serialized like the other rate-limited
  # controller tests.
  use BackendWeb.ConnCase, async: false

  alias Backend.Servers

  setup do
    owner = user_fixture(%{"username" => "ayse"})
    server = server_fixture(owner, %{"name" => "Oyun Gecesi"})
    %{owner: owner, server: server}
  end

  test "GET /api/invites/:code shows the server and inviter without signing in", %{
    conn: conn,
    owner: owner,
    server: server
  } do
    {:ok, invite} = Servers.create_invite(server.id, owner.id)

    body = conn |> get(~p"/api/invites/#{invite.code}") |> json_response(200)

    assert body == %{
             "server_name" => "Oyun Gecesi",
             "server_icon_url" => nil,
             "inviter_username" => "ayse"
           }
  end

  test "404s for an unknown code", %{conn: conn} do
    assert conn |> get(~p"/api/invites/yok-boyle-kod") |> json_response(404)
  end

  test "422s for an expired invite", %{conn: conn, owner: owner, server: server} do
    past = DateTime.utc_now() |> DateTime.add(-60) |> DateTime.truncate(:second)
    {:ok, invite} = Servers.create_invite(server.id, owner.id, %{expires_at: past})

    assert conn |> get(~p"/api/invites/#{invite.code}") |> json_response(422)
  end

  test "422s for an invite that has been used up", %{conn: conn, owner: owner, server: server} do
    {:ok, invite} = Servers.create_invite(server.id, owner.id, %{max_uses: 1})
    {:ok, _} = Servers.accept_invite(invite.code, user_fixture().id)

    assert conn |> get(~p"/api/invites/#{invite.code}") |> json_response(422)
  end

  test "shows a deleted inviter as a deleted user", %{conn: conn, server: server} do
    member = user_fixture()
    add_member_fixture(server, member)
    {:ok, invite} = Servers.create_invite(server.id, member.id)
    {:ok, _} = Backend.Accounts.delete_account(member, "password123")

    body = conn |> get(~p"/api/invites/#{invite.code}") |> json_response(200)
    assert body["inviter_username"] == "[silinmiş kullanıcı]"
  end
end
