defmodule BackendWeb.BlockControllerTest do
  use BackendWeb.ConnCase, async: true

  alias Backend.Friends

  defp authed(conn, user), do: put_req_header(conn, "authorization", "Bearer #{token_for(user)}")

  describe "POST /api/users/:id/block" do
    test "blocks the target user", %{conn: conn} do
      user = user_fixture()
      target = user_fixture()

      conn = conn |> authed(user) |> post(~p"/api/users/#{target.id}/block")

      assert conn.status == 204
      assert Friends.blocked?(user.id, target.id)
    end

    test "rejects blocking yourself", %{conn: conn} do
      user = user_fixture()

      conn = conn |> authed(user) |> post(~p"/api/users/#{user.id}/block")

      assert json_response(conn, 422) == %{"error" => "Kendinizi engelleyemezsiniz"}
    end

    test "rejects blocking a user that doesn't exist", %{conn: conn} do
      user = user_fixture()

      conn = conn |> authed(user) |> post(~p"/api/users/#{Ecto.UUID.generate()}/block")

      assert json_response(conn, 404) == %{"error" => "Kullanıcı bulunamadı"}
    end

    test "requires authentication", %{conn: conn} do
      target = user_fixture()
      conn = post(conn, ~p"/api/users/#{target.id}/block")
      assert conn.status == 401
    end
  end

  describe "DELETE /api/users/:id/block" do
    test "unblocks a previously blocked user", %{conn: conn} do
      user = user_fixture()
      target = user_fixture()
      {:ok, _} = Friends.block_user(user.id, target.id)

      conn = conn |> authed(user) |> delete(~p"/api/users/#{target.id}/block")

      assert conn.status == 204
      refute Friends.blocked?(user.id, target.id)
    end

    test "404s when the target isn't currently blocked", %{conn: conn} do
      user = user_fixture()
      target = user_fixture()

      conn = conn |> authed(user) |> delete(~p"/api/users/#{target.id}/block")

      assert json_response(conn, 404) == %{"error" => "Bu kullanıcıyı engellemediniz"}
    end

    test "requires authentication", %{conn: conn} do
      target = user_fixture()
      conn = delete(conn, ~p"/api/users/#{target.id}/block")
      assert conn.status == 401
    end
  end
end
