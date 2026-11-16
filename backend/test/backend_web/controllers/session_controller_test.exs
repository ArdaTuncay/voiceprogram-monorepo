defmodule BackendWeb.SessionControllerTest do
  @moduledoc """
  Active sessions: every sign-in is a session (device, IP, last activity),
  listed under the account, and each can be signed out on its own — its
  token stops working and its live sockets drop immediately. Renewing a
  token keeps its session; signing out ends it on the server, not just in
  the browser.
  """
  use BackendWeb.ConnCase, async: true

  require Phoenix.ChannelTest

  alias Backend.Accounts

  @endpoint BackendWeb.Endpoint

  @chrome "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
  @iphone "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"

  # A fresh IP per sign-in: the login rate limit is per IP, and these tests
  # sign in a lot.
  defp unique_ip do
    n = System.unique_integer([:positive])
    {85, rem(div(n, 62_500), 250), rem(div(n, 250), 250), rem(n, 250) + 1}
  end

  defp login(user, user_agent, ip \\ nil) do
    ip = ip || unique_ip()

    conn =
      %{build_conn() | remote_ip: ip}
      |> put_req_header("user-agent", user_agent)
      |> post(~p"/api/users/login", %{"email" => user.email, "password" => "password123"})

    json_response(conn, 200)["token"]
  end

  defp as(token) do
    n = System.unique_integer([:positive])

    %{build_conn() | remote_ip: {198, 63, rem(div(n, 250), 250), rem(n, 250) + 1}}
    |> put_req_header("authorization", "Bearer #{token}")
  end

  defp sessions(token), do: json_response(get(as(token), ~p"/api/account/sessions"), 200)

  setup do
    %{user: verified_user_fixture()}
  end

  test "each sign-in is listed with its device, IP and which one is this", %{user: user} do
    laptop = login(user, @chrome, {85, 105, 1, 10})
    phone = login(user, @iphone, {176, 33, 2, 20})

    listed = sessions(laptop)
    assert length(listed) == 2

    current = Enum.find(listed, & &1["current"])
    other = Enum.find(listed, &(!&1["current"]))

    assert current["user_agent"] == @chrome
    assert current["ip"] == "85.105.1.10"
    assert other["user_agent"] == @iphone
    assert other["ip"] == "176.33.2.20"
    assert %{"id" => _, "created_at" => _, "last_seen_at" => _} = other

    # From the phone, the phone is the current one.
    assert Enum.find(sessions(phone), & &1["current"])["user_agent"] == @iphone
  end

  test "signing out another session ends it right away, and only it", %{user: user} do
    laptop = login(user, @chrome)
    phone = login(user, @iphone)
    phone_id = Enum.find(sessions(laptop), &(!&1["current"]))["id"]

    @endpoint.subscribe("user_socket:session:#{phone_id}")
    assert response(delete(as(laptop), ~p"/api/account/sessions/#{phone_id}"), 204)

    assert_receive %Phoenix.Socket.Broadcast{event: "disconnect"}
    assert json_response(get(as(phone), ~p"/api/servers"), 401)
    assert Phoenix.ChannelTest.connect(BackendWeb.UserSocket, %{"token" => phone}) == :error

    assert json_response(get(as(laptop), ~p"/api/servers"), 200)
    assert [%{"current" => true}] = sessions(laptop)
  end

  test "someone else's session can't be signed out", %{user: user} do
    mine = login(user, @chrome)
    stranger = verified_user_fixture()
    theirs = login(stranger, @iphone)
    their_id = hd(sessions(theirs))["id"]

    assert json_response(delete(as(mine), ~p"/api/account/sessions/#{their_id}"), 404)
    assert json_response(get(as(theirs), ~p"/api/servers"), 200)
  end

  test "renewing a token keeps the same session", %{user: user} do
    token = login(user, @chrome)
    [%{"id" => id}] = sessions(token)

    renewed = json_response(post(as(token), ~p"/api/users/renew-token"), 200)["token"]

    assert [%{"id" => ^id, "current" => true}] = sessions(renewed)
  end

  test "signing out ends the session on the server too", %{user: user} do
    token = login(user, @chrome)
    other = login(user, @iphone)

    assert response(post(as(token), ~p"/api/users/logout"), 204)

    assert json_response(get(as(token), ~p"/api/servers"), 401)
    assert [%{"user_agent" => @iphone}] = sessions(other)
  end

  test "signing out everywhere ends every session", %{user: user} do
    token = login(user, @chrome)
    _other = login(user, @iphone)

    assert response(post(as(token), ~p"/api/users/logout_all"), 204)

    fresh = login(user, @chrome)
    assert [%{"current" => true}] = sessions(fresh)
  end

  test "a token from before sessions existed keeps working and gets one on renewal", %{user: user} do
    legacy =
      Phoenix.Token.sign(@endpoint, "user socket", %{
        user_id: user.id,
        token_version: Accounts.get_user(user.id).token_version
      })

    assert json_response(get(as(legacy), ~p"/api/servers"), 200)
    assert sessions(legacy) == []

    renewed = json_response(post(as(legacy), ~p"/api/users/renew-token"), 200)["token"]
    assert [%{"current" => true}] = sessions(renewed)
  end

  test "sockets are identified per session", %{user: user} do
    token = login(user, @chrome)
    [%{"id" => id}] = sessions(token)

    {:ok, socket} = Phoenix.ChannelTest.connect(BackendWeb.UserSocket, %{"token" => token})
    assert BackendWeb.UserSocket.id(socket) == "user_socket:session:#{id}"
  end
end
