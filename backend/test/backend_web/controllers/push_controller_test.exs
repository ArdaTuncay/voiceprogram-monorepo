defmodule BackendWeb.PushControllerTest do
  use BackendWeb.ConnCase, async: true

  alias Backend.{Accounts, Push, PushBrowser}

  setup do
    user = user_fixture()
    token = Accounts.generate_user_token(user)
    {:ok, _user, session_id} = Accounts.authenticate_session(token)
    %{user: user, token: token, session_id: session_id}
  end

  defp as(token, locale \\ "tr") do
    build_conn()
    |> put_req_header("authorization", "Bearer #{token}")
    |> put_req_header("accept-language", locale)
  end

  defp subscription_json(browser) do
    %{
      "endpoint" => browser.endpoint,
      "keys" => %{"p256dh" => browser.attrs["p256dh"], "auth" => browser.attrs["auth"]}
    }
  end

  test "GET /api/push gives the key browsers subscribe with", %{token: token} do
    assert json_response(get(as(token), ~p"/api/push"), 200) == %{
             "enabled" => true,
             "public_key" => Push.public_key()
           }
  end

  test "a subscription belongs to the signed-in session and speaks the request's language",
       %{user: user, token: token, session_id: session_id} do
    browser = PushBrowser.new()

    assert response(
             post(as(token, "en"), ~p"/api/push/subscriptions", subscription_json(browser)),
             204
           )

    assert [subscription] = Push.list_subscriptions(user.id)
    assert subscription.session_id == session_id
    assert subscription.locale == "en"

    assert response(
             delete(as(token), ~p"/api/push/subscriptions", %{"endpoint" => browser.endpoint}),
             204
           )

    assert Push.list_subscriptions(user.id) == []
  end

  test "an endpoint outside the browsers' push services is refused", %{token: token} do
    json =
      PushBrowser.new()
      |> subscription_json()
      |> Map.put("endpoint", "https://169.254.169.254/latest/meta-data")

    assert %{"errors" => %{"endpoint" => [_]}} =
             json_response(post(as(token), ~p"/api/push/subscriptions", json), 422)
  end

  test "needs a signed-in user" do
    assert json_response(get(build_conn(), ~p"/api/push"), 401)
  end
end
