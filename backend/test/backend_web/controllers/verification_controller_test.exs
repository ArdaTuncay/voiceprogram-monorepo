defmodule BackendWeb.VerificationControllerTest do
  use BackendWeb.ConnCase, async: true

  import Swoosh.TestAssertions

  alias Backend.Accounts
  alias Backend.Repo

  @generic_resend_message "E-posta adresiniz sistemde kayıtlıysa, doğrulama bağlantısı gönderildi"

  # POST /api/resend-verification is rate-limited (see VerificationController)
  # and every test conn shares the same fake default remote_ip — a distinct
  # IP per test keeps these well clear of each other's 5/minute allowance
  # and of verification_controller_rate_limit_test.exs's dedicated one (same
  # convention as account_controller_test.exs's with_unique_ip/2).
  defp with_unique_ip(conn, last_octet), do: %{conn | remote_ip: {203, 0, 113, last_octet}}

  describe "GET /api/verify-email/:token" do
    test "verifies the user and clears the token on a valid, unexpired token", %{conn: conn} do
      user = user_fixture()
      {:ok, _updated, token} = Accounts.generate_email_verification_token(user)

      conn = get(conn, ~p"/api/verify-email/#{token}")

      assert json_response(conn, 200) == %{"message" => "E-posta doğrulandı"}

      reloaded = Accounts.get_user(user.id)
      assert reloaded.email_verified
      assert reloaded.email_verification_token == nil
    end

    test "rejects an unknown token with 404 invalid_token", %{conn: conn} do
      conn = get(conn, ~p"/api/verify-email/does-not-exist")

      assert json_response(conn, 404) == %{"error" => "invalid_token"}
    end

    test "rejects a token older than 24h with 410 token_expired, without verifying", %{
      conn: conn
    } do
      user = user_fixture()
      {:ok, updated, token} = Accounts.generate_email_verification_token(user)

      stale_sent_at =
        DateTime.utc_now() |> DateTime.add(-25 * 60 * 60, :second) |> DateTime.truncate(:second)

      {:ok, _} =
        updated
        |> Ecto.Changeset.change(email_verification_sent_at: stale_sent_at)
        |> Repo.update()

      conn = get(conn, ~p"/api/verify-email/#{token}")

      assert json_response(conn, 410) == %{"error" => "token_expired"}
      refute Accounts.get_user(user.id).email_verified
    end
  end

  describe "POST /api/resend-verification" do
    test "issues a new token and sends a new email for an unverified user", %{conn: conn} do
      user = user_fixture()

      conn =
        conn
        |> with_unique_ip(150)
        |> post(~p"/api/resend-verification", %{"email" => user.email})

      assert json_response(conn, 200) == %{"message" => @generic_resend_message}

      reloaded = Accounts.get_user(user.id)
      assert reloaded.email_verification_token
      assert reloaded.email_verification_token != user.email_verification_token

      assert_email_sent(to: user.email)
    end

    test "returns the same generic message for an unknown email, without sending mail", %{
      conn: conn
    } do
      conn =
        conn
        |> with_unique_ip(151)
        |> post(~p"/api/resend-verification", %{"email" => "nobody@example.com"})

      assert json_response(conn, 200) == %{"message" => @generic_resend_message}
      refute_email_sent(to: "nobody@example.com")
    end

    test "returns the same generic message for an already-verified user, without sending mail",
         %{conn: conn} do
      user = verified_user_fixture()

      conn =
        conn
        |> with_unique_ip(152)
        |> post(~p"/api/resend-verification", %{"email" => user.email})

      assert json_response(conn, 200) == %{"message" => @generic_resend_message}
      refute_email_sent()
    end

    test "requires an email param", %{conn: conn} do
      conn =
        conn
        |> with_unique_ip(153)
        |> post(~p"/api/resend-verification", %{})

      assert json_response(conn, 400) == %{"error" => "email gerekli"}
    end
  end
end
