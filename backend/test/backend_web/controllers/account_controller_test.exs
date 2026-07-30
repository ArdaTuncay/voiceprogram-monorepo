defmodule BackendWeb.AccountControllerTest do
  use BackendWeb.ConnCase, async: true

  defp authed(conn, user), do: put_req_header(conn, "authorization", "Bearer #{token_for(user)}")

  describe "PATCH /api/account/username" do
    test "updates the username with the correct current password", %{conn: conn} do
      user = user_fixture(%{"password" => "correct-password"})

      conn =
        conn
        |> authed(user)
        |> patch(~p"/api/account/username", %{
          "username" => "renamed_user",
          "current_password" => "correct-password"
        })

      assert json_response(conn, 200)["username"] == "renamed_user"
    end

    test "rejects a wrong current password and leaves the username unchanged", %{conn: conn} do
      user = user_fixture(%{"password" => "correct-password"})

      conn =
        conn
        |> authed(user)
        |> patch(~p"/api/account/username", %{
          "username" => "renamed_user",
          "current_password" => "wrong-password"
        })

      assert json_response(conn, 401) == %{"error" => "Mevcut şifre yanlış"}
      assert Backend.Accounts.get_user(user.id).username == user.username
    end

    test "rejects a username already taken by another user", %{conn: conn} do
      _existing = user_fixture(%{"username" => "already_taken"})
      user = user_fixture(%{"password" => "correct-password"})

      conn =
        conn
        |> authed(user)
        |> patch(~p"/api/account/username", %{
          "username" => "already_taken",
          "current_password" => "correct-password"
        })

      assert %{"errors" => %{"username" => [_ | _]}} = json_response(conn, 422)
    end

    test "requires authentication", %{conn: conn} do
      conn =
        patch(conn, ~p"/api/account/username", %{
          "username" => "renamed_user",
          "current_password" => "whatever"
        })

      assert conn.status == 401
    end
  end

  describe "PATCH /api/account/email" do
    test "updates the email with the correct current password", %{conn: conn} do
      user = user_fixture(%{"password" => "correct-password"})

      conn =
        conn
        |> authed(user)
        |> patch(~p"/api/account/email", %{
          "email" => "new-address@example.com",
          "current_password" => "correct-password"
        })

      assert json_response(conn, 200)["email"] == "new-address@example.com"
    end

    test "rejects a wrong current password and leaves the email unchanged", %{conn: conn} do
      user = user_fixture(%{"password" => "correct-password"})

      conn =
        conn
        |> authed(user)
        |> patch(~p"/api/account/email", %{
          "email" => "new-address@example.com",
          "current_password" => "wrong-password"
        })

      assert json_response(conn, 401) == %{"error" => "Mevcut şifre yanlış"}
      assert Backend.Accounts.get_user(user.id).email == user.email
    end

    test "rejects an email already taken by another user", %{conn: conn} do
      _existing = user_fixture(%{"email" => "already-taken@example.com"})
      user = user_fixture(%{"password" => "correct-password"})

      conn =
        conn
        |> authed(user)
        |> patch(~p"/api/account/email", %{
          "email" => "already-taken@example.com",
          "current_password" => "correct-password"
        })

      assert %{"errors" => %{"email" => [_ | _]}} = json_response(conn, 422)
    end

    test "requires authentication", %{conn: conn} do
      conn =
        patch(conn, ~p"/api/account/email", %{
          "email" => "new-address@example.com",
          "current_password" => "whatever"
        })

      assert conn.status == 401
    end
  end

  describe "PATCH /api/account/password" do
    test "updates the password with the correct current password", %{conn: conn} do
      user = user_fixture(%{"password" => "old-password123"})

      conn =
        conn
        |> authed(user)
        |> patch(~p"/api/account/password", %{
          "current_password" => "old-password123",
          "new_password" => "new-password456"
        })

      assert json_response(conn, 200)["id"] == user.id

      assert Backend.Accounts.verify_password?(
               Backend.Accounts.get_user(user.id),
               "new-password456"
             )
    end

    test "rejects a wrong current password and leaves the password unchanged", %{conn: conn} do
      user = user_fixture(%{"password" => "old-password123"})

      conn =
        conn
        |> authed(user)
        |> patch(~p"/api/account/password", %{
          "current_password" => "totally-wrong",
          "new_password" => "new-password456"
        })

      assert json_response(conn, 401) == %{"error" => "Mevcut şifre yanlış"}

      assert Backend.Accounts.verify_password?(
               Backend.Accounts.get_user(user.id),
               "old-password123"
             )
    end

    test "rejects a too-short new password", %{conn: conn} do
      user = user_fixture(%{"password" => "old-password123"})

      conn =
        conn
        |> authed(user)
        |> patch(~p"/api/account/password", %{
          "current_password" => "old-password123",
          "new_password" => "short"
        })

      assert %{"errors" => %{"password" => [_ | _]}} = json_response(conn, 422)
    end

    test "invalidates the token used to make this very request", %{conn: conn} do
      user = user_fixture(%{"password" => "old-password123"})
      old_token = token_for(user)

      conn
      |> put_req_header("authorization", "Bearer #{old_token}")
      |> patch(~p"/api/account/password", %{
        "current_password" => "old-password123",
        "new_password" => "new-password456"
      })
      |> json_response(200)

      conn2 =
        build_conn()
        |> put_req_header("authorization", "Bearer #{old_token}")
        |> get(~p"/api/friends")

      assert conn2.status == 401
    end

    test "requires authentication", %{conn: conn} do
      conn =
        patch(conn, ~p"/api/account/password", %{
          "current_password" => "whatever",
          "new_password" => "new-password456"
        })

      assert conn.status == 401
    end
  end

  describe "PATCH /api/account/friend-request-privacy" do
    test "updates the preference", %{conn: conn} do
      user = user_fixture()

      conn =
        conn
        |> authed(user)
        |> patch(~p"/api/account/friend-request-privacy", %{"friend_request_privacy" => "nobody"})

      assert json_response(conn, 200) == %{"friend_request_privacy" => "nobody"}
    end

    test "rejects an invalid value", %{conn: conn} do
      user = user_fixture()

      conn =
        conn
        |> authed(user)
        |> patch(~p"/api/account/friend-request-privacy", %{
          "friend_request_privacy" => "friends_only"
        })

      assert %{"errors" => %{"friend_request_privacy" => [_ | _]}} = json_response(conn, 422)
    end

    test "requires authentication", %{conn: conn} do
      conn =
        patch(conn, ~p"/api/account/friend-request-privacy", %{
          "friend_request_privacy" => "nobody"
        })

      assert conn.status == 401
    end
  end

  describe "GET /api/account/blocked-users" do
    test "lists users the caller has blocked", %{conn: conn} do
      user = user_fixture()
      target = user_fixture()
      {:ok, _} = Backend.Friends.block_user(user.id, target.id)

      conn = conn |> authed(user) |> get(~p"/api/account/blocked-users")

      assert json_response(conn, 200) == [
               %{"user_id" => target.id, "username" => target.username}
             ]
    end

    test "requires authentication", %{conn: conn} do
      conn = get(conn, ~p"/api/account/blocked-users")
      assert conn.status == 401
    end
  end
end
