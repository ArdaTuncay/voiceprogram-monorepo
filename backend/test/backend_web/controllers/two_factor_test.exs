defmodule BackendWeb.TwoFactorTest do
  @moduledoc """
  Two-factor sign-in (TOTP, as in Google Authenticator/Authy/1Password).
  Setting it up takes the current password and a working code; from then
  on a correct password only gets a short-lived challenge, and the session
  token comes after a code — or one of ten single-use recovery codes.
  """
  use BackendWeb.ConnCase, async: true

  alias Backend.Accounts.User
  alias Backend.Repo

  @step 30

  defp ip do
    n = System.unique_integer([:positive])
    {86, rem(div(n, 62_500), 250), rem(div(n, 250), 250), rem(n, 250) + 1}
  end

  defp anon, do: %{build_conn() | remote_ip: ip()}
  defp as(token), do: anon() |> put_req_header("authorization", "Bearer #{token}")

  # A code for the time step `offset` steps from now — distinct steps keep
  # one test's codes from counting as replays of another's.
  defp code(secret, offset \\ 0),
    do:
      NimbleTOTP.verification_code(Base.decode32!(secret, padding: false),
        time: System.os_time(:second) + offset * @step
      )

  defp login(user) do
    json_response(
      post(anon(), ~p"/api/users/login", %{"email" => user.email, "password" => "password123"}),
      200
    )
  end

  defp finish(challenge, code) do
    post(anon(), ~p"/api/users/login/2fa", %{"challenge" => challenge, "code" => code})
  end

  # Turns two-factor on through the API; returns {token, secret, recovery codes}.
  defp enable(user) do
    %{"token" => token} = login(user)

    setup =
      json_response(
        post(as(token), ~p"/api/account/2fa/setup", %{"current_password" => "password123"}),
        200
      )

    %{"recovery_codes" => codes} =
      json_response(
        post(as(token), ~p"/api/account/2fa/enable", %{
          "setup_token" => setup["setup_token"],
          "code" => code(setup["secret"], -1)
        }),
        200
      )

    {token, setup["secret"], codes}
  end

  setup do
    %{user: verified_user_fixture()}
  end

  describe "setting up" do
    test "takes the current password and returns a secret, an otpauth link and a QR code", %{
      user: user
    } do
      %{"token" => token} = login(user)

      # 403, not 401: the session is fine, only the password is wrong (a 401
      # signs the web app out).
      assert json_response(
               post(as(token), ~p"/api/account/2fa/setup", %{"current_password" => "wrong"}),
               403
             )

      assert json_response(get(as(token), ~p"/api/account/2fa"), 200)

      setup =
        json_response(
          post(as(token), ~p"/api/account/2fa/setup", %{"current_password" => "password123"}),
          200
        )

      assert setup["secret"] =~ ~r/\A[A-Z2-7]{32}\z/
      assert setup["otpauth_uri"] =~ "otpauth://totp/Zircle:"
      assert setup["otpauth_uri"] =~ "issuer=Zircle"
      assert "data:image/svg+xml;base64," <> svg = setup["qr_data_uri"]
      assert Base.decode64!(svg) =~ "<svg"
      assert is_binary(setup["setup_token"])

      # Nothing changes until a code confirms the app has the secret.
      assert json_response(get(as(token), ~p"/api/account/2fa"), 200)["enabled"] == false
    end

    test "needs a working code, then hands out ten single-use recovery codes", %{user: user} do
      %{"token" => token} = login(user)

      setup =
        json_response(
          post(as(token), ~p"/api/account/2fa/setup", %{"current_password" => "password123"}),
          200
        )

      wrong =
        post(as(token), ~p"/api/account/2fa/enable", %{
          "setup_token" => setup["setup_token"],
          "code" => "000000"
        })

      assert json_response(wrong, 422)
      assert json_response(get(as(token), ~p"/api/account/2fa"), 200)["enabled"] == false

      ok =
        post(as(token), ~p"/api/account/2fa/enable", %{
          "setup_token" => setup["setup_token"],
          "code" => code(setup["secret"])
        })

      codes = json_response(ok, 200)["recovery_codes"]
      assert length(codes) == 10
      assert length(Enum.uniq(codes)) == 10
      assert Enum.all?(codes, &(&1 =~ ~r/\A[a-z2-7]{5}-[a-z2-7]{5}\z/))

      assert %{"enabled" => true, "recovery_codes_left" => 10} =
               json_response(get(as(token), ~p"/api/account/2fa"), 200)
    end

    test "keeps the secret encrypted and the recovery codes hashed", %{user: user} do
      {_token, secret, codes} = enable(user)
      stored = Repo.get!(User, user.id)

      refute stored.totp_secret =~ secret
      refute stored.totp_secret =~ Base.decode32!(secret, padding: false)
      refute Enum.any?(stored.totp_recovery_hashes, &(&1 in codes))
    end
  end

  describe "signing in" do
    test "a correct password only gets a challenge; the code gets the session", %{user: user} do
      {_token, secret, _codes} = enable(user)

      response = login(user)
      assert %{"two_factor" => true, "challenge" => challenge} = response
      refute Map.has_key?(response, "token")

      %{"token" => token, "id" => id} = json_response(finish(challenge, code(secret)), 200)
      assert id == user.id
      assert json_response(get(as(token), ~p"/api/servers"), 200)
    end

    test "a code can't be used twice", %{user: user} do
      {_token, secret, _codes} = enable(user)
      current = code(secret)

      assert json_response(finish(login(user)["challenge"], current), 200)
      assert json_response(finish(login(user)["challenge"], current), 401)
      # The next code is fine.
      assert json_response(finish(login(user)["challenge"], code(secret, 1)), 200)
    end

    test "a wrong code, or a forged or stale challenge, gets nothing", %{user: user} do
      {_token, secret, _codes} = enable(user)
      challenge = login(user)["challenge"]

      assert json_response(finish(challenge, "123456"), 401)
      assert json_response(finish("forged", code(secret)), 401)

      stale =
        Phoenix.Token.sign(BackendWeb.Endpoint, "two factor challenge", %{user_id: user.id, v: 0},
          signed_at: System.system_time(:second) - 600
        )

      assert json_response(finish(stale, code(secret)), 401)
    end

    test "a recovery code works once", %{user: user} do
      {token, _secret, [recovery | _]} = enable(user)

      assert json_response(finish(login(user)["challenge"], String.upcase(recovery)), 200)
      assert json_response(finish(login(user)["challenge"], recovery), 401)
      assert json_response(get(as(token), ~p"/api/account/2fa"), 200)["recovery_codes_left"] == 9
    end

    test "too many wrong codes lock the account's two-factor step for a while", %{user: user} do
      {_token, secret, _codes} = enable(user)
      challenge = login(user)["challenge"]

      for _ <- 1..10, do: finish(challenge, "000000")

      assert json_response(finish(challenge, code(secret)), 429)
    end
  end

  describe "turning it off" do
    test "takes the current password and a code; then a password is enough again", %{user: user} do
      {token, secret, _codes} = enable(user)

      assert json_response(
               post(as(token), ~p"/api/account/2fa/disable", %{
                 "current_password" => "password123",
                 "code" => "000000"
               }),
               422
             )

      assert response(
               post(as(token), ~p"/api/account/2fa/disable", %{
                 "current_password" => "password123",
                 "code" => code(secret)
               }),
               204
             )

      assert %{"token" => _} = login(user)
      assert json_response(get(as(token), ~p"/api/account/2fa"), 200)["enabled"] == false
    end
  end
end
