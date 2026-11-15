defmodule BackendWeb.SessionRenewalTest do
  @moduledoc """
  Sessions used to end 24 hours after login no matter how active the user
  was. Tokens now last 7 days and an open app renews its own token
  (POST /api/users/renew-token), so only a device left unused for a week
  gets signed out. Revocation (logout_all, password change) still applies
  immediately.
  """
  use BackendWeb.ConnCase, async: true

  alias Backend.Accounts

  @day 24 * 60 * 60

  # A token for `user` as if it had been issued `days` ago.
  defp token_issued_days_ago(user, days) do
    Phoenix.Token.sign(
      BackendWeb.Endpoint,
      "user socket",
      %{user_id: user.id, token_version: user.token_version},
      signed_at: System.system_time(:second) - days * @day
    )
  end

  defp renew(token) do
    n = System.unique_integer([:positive])

    %{build_conn() | remote_ip: {198, 54, rem(div(n, 250), 250), rem(n, 250) + 1}}
    |> put_req_header("authorization", "Bearer #{token}")
    |> post(~p"/api/users/renew-token")
  end

  test "a 3-day-old token still works (it used to expire after 24 h)" do
    user = user_fixture()

    assert {:ok, _} = Accounts.authenticate_token(token_issued_days_ago(user, 3))
  end

  test "a token unused for more than 7 days no longer works" do
    user = user_fixture()

    assert {:error, :invalid} = Accounts.authenticate_token(token_issued_days_ago(user, 8))
  end

  test "renewing returns a fresh token that works, for the same user" do
    user = user_fixture()

    conn = renew(token_issued_days_ago(user, 6))

    assert %{"token" => fresh} = json_response(conn, 200)
    user_id = user.id
    assert {:ok, %{id: ^user_id}} = Accounts.authenticate_token(fresh)
  end

  test "a revoked token can't be renewed into a working one" do
    user = user_fixture()
    old = token_for(user)
    {:ok, _} = Accounts.revoke_all_tokens(user)

    assert renew(old).status == 401
  end

  test "an expired token can't be renewed" do
    user = user_fixture()

    assert renew(token_issued_days_ago(user, 8)).status == 401
  end
end
