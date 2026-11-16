defmodule BackendWeb.EmailChangeTest do
  @moduledoc """
  Changing the account email: PATCH /api/account/email no longer applies
  the address directly; it emails a confirmation link to the NEW address
  and a notice to the OLD one, and the change happens only when the link
  is followed (POST /api/account/email/confirm).
  """
  use BackendWeb.ConnCase, async: true

  import Swoosh.TestAssertions

  alias Backend.Accounts
  alias Backend.Accounts.User
  alias Backend.Repo

  defp with_unique_ip(conn, n), do: %{conn | remote_ip: {198, 51, 101, n}}

  # PATCH /api/account/email is rate-limited per IP as well as per user; a
  # fresh fake IP per request keeps these tests (and account_controller_test's)
  # out of one shared bucket.
  defp request_change(user, new_email, password \\ "correct-password") do
    n = System.unique_integer([:positive])

    %{build_conn() | remote_ip: {198, 52, rem(div(n, 250), 250), rem(n, 250) + 1}}
    |> put_req_header("authorization", "Bearer #{token_for(user)}")
    |> patch(~p"/api/account/email", %{"email" => new_email, "current_password" => password})
  end

  defp confirm(token, octet) do
    build_conn()
    |> with_unique_ip(octet)
    |> post(~p"/api/account/email/confirm", %{"token" => token})
  end

  # The confirmation email goes to the new address and carries the link.
  # Each request sends two emails (confirmation + notice), so this skips
  # past others to the matching one instead of insisting it's next.
  defp confirmation_token_sent_to(address) do
    email =
      find_sent_email(&(&1.to == [{"", address}] and &1.text_body =~ "/confirm-email/"))

    [_, token] = Regex.run(~r{/confirm-email/([A-Za-z0-9_-]+)}, email.text_body)
    token
  end

  defp find_sent_email(matches?) do
    receive do
      {:email, email} -> if matches?.(email), do: email, else: find_sent_email(matches?)
    after
      0 -> flunk("no matching email was sent")
    end
  end

  setup do
    %{user: user_fixture(%{"email" => "eski@example.com", "password" => "correct-password"})}
  end

  test "asks the new address to confirm, warns the old one, and changes nothing yet", %{
    user: user
  } do
    conn = request_change(user, "yeni@example.com")

    assert %{"pending_email" => "yeni@example.com", "message" => _} = json_response(conn, 202)
    _token = confirmation_token_sent_to("yeni@example.com")

    assert_email_sent(fn email ->
      email.to == [{"", "eski@example.com"}] and email.text_body =~ "yeni@example.com"
    end)

    stored = Repo.get!(User, user.id)
    assert stored.email == "eski@example.com"
    assert stored.pending_email == "yeni@example.com"
    assert stored.pending_email_token_hash
  end

  test "following the link applies the change, marks it verified, and works only once", %{
    user: user
  } do
    request_change(user, "yeni@example.com")
    token = confirmation_token_sent_to("yeni@example.com")

    assert json_response(confirm(token, 1), 200)["email"] == "yeni@example.com"

    stored = Repo.get!(User, user.id)
    assert stored.email == "yeni@example.com"
    assert stored.email_verified
    assert stored.pending_email == nil
    assert stored.pending_email_token_hash == nil
    assert {:ok, _} = Accounts.authenticate_user("yeni@example.com", "correct-password")

    assert json_response(confirm(token, 2), 404) == %{"error" => "invalid_token"}
  end

  test "the token isn't stored in plain text", %{user: user} do
    request_change(user, "yeni@example.com")
    token = confirmation_token_sent_to("yeni@example.com")

    refute inspect(Map.from_struct(Repo.get!(User, user.id))) =~ token
  end

  test "a link older than 24 hours no longer works", %{user: user} do
    request_change(user, "yeni@example.com")
    token = confirmation_token_sent_to("yeni@example.com")

    stale = DateTime.utc_now() |> DateTime.add(-25 * 3600, :second) |> DateTime.truncate(:second)

    Repo.get!(User, user.id)
    |> Ecto.Changeset.change(pending_email_sent_at: stale)
    |> Repo.update!()

    assert json_response(confirm(token, 3), 410) == %{"error" => "token_expired"}
    assert Repo.get!(User, user.id).email == "eski@example.com"
  end

  test "only the newest request's link works", %{user: user} do
    request_change(user, "ilk@example.com")
    first = confirmation_token_sent_to("ilk@example.com")
    request_change(user, "ikinci@example.com")
    second = confirmation_token_sent_to("ikinci@example.com")

    assert json_response(confirm(first, 4), 404)
    assert json_response(confirm(second, 5), 200)["email"] == "ikinci@example.com"
  end

  test "if someone else took the address meanwhile, the change fails cleanly", %{user: user} do
    request_change(user, "kapisilan@example.com")
    token = confirmation_token_sent_to("kapisilan@example.com")
    user_fixture(%{"email" => "kapisilan@example.com"})

    assert %{"errors" => %{"email" => ["has already been taken"]}} =
             json_response(confirm(token, 6), 422)

    assert Repo.get!(User, user.id).email == "eski@example.com"
  end

  test "rejects an address another account already uses, sending nothing", %{user: user} do
    user_fixture(%{"email" => "dolu@example.com"})

    assert %{"errors" => %{"email" => ["has already been taken"]}} =
             json_response(request_change(user, "dolu@example.com"), 422)

    assert_no_email_sent()
  end

  test "rejects the current address and malformed ones, sending nothing", %{user: user} do
    assert %{"errors" => %{"email" => [_ | _]}} =
             json_response(request_change(user, "eski@example.com"), 422)

    assert %{"errors" => %{"email" => [_ | _]}} =
             json_response(request_change(user, "adres-degil"), 422)

    assert_no_email_sent()
  end

  test "a wrong current password sends nothing", %{user: user} do
    assert json_response(request_change(user, "yeni@example.com", "yanlis"), 403)
    assert_no_email_sent()
  end

  test "confirming requires a token" do
    conn = build_conn() |> with_unique_ip(7) |> post(~p"/api/account/email/confirm", %{})

    assert json_response(conn, 400)["error"]
  end
end
