defmodule BackendWeb.UserControllerTest do
  use BackendWeb.ConnCase, async: true

  import Swoosh.TestAssertions

  alias Backend.Accounts

  # BackendWeb.RateLimiterPlug always hits a per-IP bucket (see its own
  # moduledoc) — every test conn shares the same fake default remote_ip, so
  # a distinct one per test keeps this file's handful of register/login
  # calls well clear of each other's 5/minute allowance (same convention as
  # account_controller_test.exs's with_unique_ip/2).
  defp with_unique_ip(conn, last_octet), do: %{conn | remote_ip: {203, 0, 113, last_octet}}

  describe "POST /api/users/register" do
    test "creates an unverified user, emails a verification link, and returns no auth token", %{
      conn: conn
    } do
      conn =
        conn
        |> with_unique_ip(120)
        |> post(~p"/api/users/register", %{
          "username" => "new_user",
          "email" => "new_user@example.com",
          "password" => "password123"
        })

      assert json_response(conn, 201) == %{
               "message" =>
                 "Kayıt başarılı, lütfen e-postanızı kontrol edip hesabınızı doğrulayın",
               "email_verification_required" => true
             }

      user = Accounts.get_user_by_email("new_user@example.com")
      refute user.email_verified
      assert user.email_verification_token
      assert user.email_verification_sent_at

      assert_email_sent(to: "new_user@example.com")
    end

    test "still rejects invalid registration attrs with a changeset error", %{conn: conn} do
      conn =
        conn
        |> with_unique_ip(121)
        |> post(~p"/api/users/register", %{
          "username" => "a",
          "email" => "not-an-email",
          "password" => "short"
        })

      assert %{"errors" => errors} = json_response(conn, 422)
      assert errors["email"]
      assert errors["password"]
      refute_email_sent()
    end
  end

  describe "POST /api/users/login" do
    test "rejects an unverified user with 403 email_not_verified and no token", %{conn: conn} do
      user = user_fixture(%{"password" => "correct-password"})
      refute user.email_verified

      conn =
        conn
        |> with_unique_ip(122)
        |> post(~p"/api/users/login", %{"email" => user.email, "password" => "correct-password"})

      assert json_response(conn, 403) == %{"error" => "email_not_verified"}
    end

    test "logs in a verified user and returns a usable token", %{conn: conn} do
      user = verified_user_fixture(%{"password" => "correct-password"})

      conn =
        conn
        |> with_unique_ip(123)
        |> post(~p"/api/users/login", %{"email" => user.email, "password" => "correct-password"})

      assert %{"token" => token, "id" => id} = json_response(conn, 200)
      assert id == user.id
      assert {:ok, %{id: ^id}} = Accounts.authenticate_token(token)
    end

    test "rejects a wrong password with 401 even for a verified user", %{conn: conn} do
      user = verified_user_fixture(%{"password" => "correct-password"})

      conn =
        conn
        |> with_unique_ip(124)
        |> post(~p"/api/users/login", %{"email" => user.email, "password" => "wrong-password"})

      assert json_response(conn, 401) == %{"error" => "Invalid email or password"}
    end
  end
end
