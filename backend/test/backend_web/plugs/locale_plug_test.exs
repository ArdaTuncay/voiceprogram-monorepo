defmodule BackendWeb.LocalePlugTest do
  @moduledoc """
  API messages and account emails follow the client's `Accept-Language`
  (the web app sends its UI language on every request); Turkish when there
  is none or it names nothing we have.
  """
  use BackendWeb.ConnCase, async: true

  import Swoosh.TestAssertions

  alias BackendWeb.LocalePlug

  defp login(language) do
    conn = build_conn()
    conn = if language, do: put_req_header(conn, "accept-language", language), else: conn

    post(conn, ~p"/api/users/login", %{
      "email" => "nobody@example.com",
      "password" => "wrong-pass"
    })
  end

  describe "API messages" do
    test "are Turkish by default" do
      assert json_response(login(nil), 401) == %{"error" => "E-posta veya şifre hatalı"}
    end

    test "are English when the client asks for it" do
      assert json_response(login("en"), 401) == %{"error" => "Invalid email or password"}
      assert json_response(login("en-US,en;q=0.9"), 401)["error"] == "Invalid email or password"
    end

    test "fall back to Turkish for a language we don't have" do
      assert json_response(login("de-DE,de;q=0.9"), 401)["error"] == "E-posta veya şifre hatalı"
    end

    test "carry interpolated values in either language" do
      user = user_fixture()
      path = Path.join(System.tmp_dir!(), "lp-#{System.unique_integer([:positive])}")
      File.write!(path, "MZ")
      on_exit(fn -> File.rm(path) end)
      upload = %Plug.Upload{path: path, filename: "a.exe", content_type: ""}

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer #{token_for(user)}")
        |> put_req_header("accept-language", "en")
        |> post(~p"/api/upload", %{"file" => upload})

      assert json_response(conn, 422)["error"] =~ "Unsupported file type. Allowed: PNG"
    end
  end

  describe "account emails" do
    test "are written in the requester's language" do
      user = verified_user_fixture()

      build_conn()
      |> put_req_header("accept-language", "en")
      |> post(~p"/api/password-reset", %{"email" => user.email})

      assert_email_sent(fn email ->
        assert email.subject == "Zircle - Password Reset"
        assert email.text_body =~ "Hi #{user.username},"
        assert email.html_body =~ "Set a new password"
      end)

      build_conn() |> post(~p"/api/password-reset", %{"email" => user.email})

      assert_email_sent(fn email ->
        assert email.subject == "Zircle - Şifre Sıfırlama"
        assert email.text_body =~ "Merhaba #{user.username},"
      end)
    end
  end

  describe "preferred_locale/1" do
    test "honours q-values and region subtags" do
      assert LocalePlug.preferred_locale("tr-TR,tr;q=0.9,en;q=0.8") == "tr"
      assert LocalePlug.preferred_locale("de;q=1.0,en;q=0.5,tr;q=0.4") == "en"
      assert LocalePlug.preferred_locale("EN-gb") == "en"
      assert LocalePlug.preferred_locale("") == "tr"
      assert LocalePlug.preferred_locale("en;q=0,tr;q=0.1") == "tr"
      assert LocalePlug.preferred_locale("*;q=x,garbage") == "tr"
    end
  end
end
