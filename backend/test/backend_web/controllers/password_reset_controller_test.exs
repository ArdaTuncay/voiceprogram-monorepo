defmodule BackendWeb.PasswordResetControllerTest do
  use BackendWeb.ConnCase, async: true

  import Swoosh.TestAssertions

  alias Backend.Accounts
  alias Backend.Accounts.User
  alias Backend.Repo

  @generic_message "E-posta adresiniz sistemde kayıtlıysa, şifre sıfırlama bağlantısı gönderildi"

  # Both endpoints are rate-limited per IP; a distinct fake IP per test keeps
  # them out of each other's buckets (same convention as the other
  # controller tests).
  defp with_unique_ip(conn, last_octet), do: %{conn | remote_ip: {203, 0, 114, last_octet}}

  defp request_reset(conn, email, octet) do
    conn |> with_unique_ip(octet) |> post(~p"/api/password-reset", %{"email" => email})
  end

  defp confirm(conn, token, password, octet) do
    conn
    |> with_unique_ip(octet)
    |> post(~p"/api/password-reset/confirm", %{"token" => token, "password" => password})
  end

  # Pulls the token out of the reset link in the email that was just sent.
  defp sent_token do
    assert_email_sent(fn email ->
      [_, token] = Regex.run(~r{/reset-password/([A-Za-z0-9_-]+)}, email.text_body)
      send(self(), {:reset_token, token})
      true
    end)

    assert_received {:reset_token, token}
    token
  end

  describe "POST /api/password-reset" do
    test "emails a reset link to a registered address, storing only a hash of the token", %{
      conn: conn
    } do
      user = user_fixture(%{"email" => "unuttum@example.com"})

      conn = request_reset(conn, "unuttum@example.com", 1)

      assert json_response(conn, 200) == %{"message" => @generic_message}
      token = sent_token()

      stored = Repo.get!(User, user.id)
      assert stored.password_reset_sent_at
      assert stored.password_reset_token_hash
      refute stored.password_reset_token_hash == token
      refute inspect(Map.from_struct(stored)) =~ token
    end

    test "answers identically for an unknown address and sends nothing", %{conn: conn} do
      conn = request_reset(conn, "kimse@example.com", 2)

      assert json_response(conn, 200) == %{"message" => @generic_message}
      assert_no_email_sent()
    end

    test "sends nothing for a deleted account", %{conn: conn} do
      user = user_fixture(%{"password" => "password123"})
      {:ok, deleted} = Accounts.delete_account(user, "password123")

      conn = request_reset(conn, deleted.email, 3)

      assert json_response(conn, 200) == %{"message" => @generic_message}
      assert_no_email_sent()
    end

    test "requires an email", %{conn: conn} do
      conn = conn |> with_unique_ip(4) |> post(~p"/api/password-reset", %{})

      assert json_response(conn, 400)["error"]
    end
  end

  describe "POST /api/password-reset/confirm" do
    test "sets the new password, signs out every session, and can't be reused", %{conn: conn} do
      user = user_fixture(%{"email" => "yeni@example.com", "password" => "eski-parola"})
      old_session = token_for(user)
      request_reset(conn, "yeni@example.com", 10)
      token = sent_token()

      response = confirm(build_conn(), token, "yepyeni-parola", 11)

      assert json_response(response, 200)["message"]
      assert {:ok, _} = Accounts.authenticate_user("yeni@example.com", "yepyeni-parola")
      assert {:error, _} = Accounts.authenticate_user("yeni@example.com", "eski-parola")
      assert {:error, :invalid} = Accounts.authenticate_token(old_session)

      again = confirm(build_conn(), token, "baska-parola-1", 12)
      assert json_response(again, 404) == %{"error" => "invalid_token"}
    end

    test "also marks the email verified — following the link proves the address", %{conn: conn} do
      user = user_fixture(%{"email" => "dogrulanmamis@example.com"})
      refute user.email_verified
      request_reset(conn, "dogrulanmamis@example.com", 13)

      confirm(build_conn(), sent_token(), "yepyeni-parola", 14)

      assert Repo.get!(User, user.id).email_verified
    end

    test "rejects an unknown token", %{conn: conn} do
      conn = confirm(conn, "boyle-bir-token-yok", "yepyeni-parola", 15)

      assert json_response(conn, 404) == %{"error" => "invalid_token"}
    end

    test "rejects a token older than an hour without changing the password", %{conn: conn} do
      user = user_fixture(%{"email" => "gec@example.com", "password" => "eski-parola"})
      request_reset(conn, "gec@example.com", 16)
      token = sent_token()

      stale = DateTime.utc_now() |> DateTime.add(-61 * 60, :second) |> DateTime.truncate(:second)

      Repo.get!(User, user.id)
      |> Ecto.Changeset.change(password_reset_sent_at: stale)
      |> Repo.update!()

      response = confirm(build_conn(), token, "yepyeni-parola", 17)

      assert json_response(response, 410) == %{"error" => "token_expired"}
      assert {:ok, _} = Accounts.authenticate_user("gec@example.com", "eski-parola")
    end

    test "rejects a too-short password and leaves the link usable", %{conn: conn} do
      user_fixture(%{"email" => "kisa@example.com"})
      request_reset(conn, "kisa@example.com", 18)
      token = sent_token()

      short = confirm(build_conn(), token, "kisa", 19)
      assert %{"errors" => %{"password" => [_ | _]}} = json_response(short, 422)

      ok = confirm(build_conn(), token, "yeterince-uzun", 20)
      assert json_response(ok, 200)["message"]
    end

    test "only the newest link works after asking twice", %{conn: conn} do
      user_fixture(%{"email" => "iki@example.com"})
      request_reset(conn, "iki@example.com", 21)
      first = sent_token()
      request_reset(build_conn(), "iki@example.com", 22)
      second = sent_token()

      assert json_response(confirm(build_conn(), first, "yepyeni-parola", 23), 404)
      assert json_response(confirm(build_conn(), second, "yepyeni-parola", 24), 200)
    end

    test "changing the password the normal way invalidates an outstanding link", %{conn: conn} do
      user = user_fixture(%{"email" => "degisti@example.com", "password" => "eski-parola"})
      request_reset(conn, "degisti@example.com", 25)
      token = sent_token()

      {:ok, _} = Accounts.update_password(Repo.get!(User, user.id), "eski-parola", "baska-parola")

      assert json_response(confirm(build_conn(), token, "yepyeni-parola", 26), 404)
    end

    test "requires both token and password", %{conn: conn} do
      conn =
        conn |> with_unique_ip(27) |> post(~p"/api/password-reset/confirm", %{"token" => "x"})

      assert json_response(conn, 400)["error"]
    end
  end
end
