defmodule BackendWeb.VerificationController do
  use BackendWeb, :controller

  alias Backend.Accounts
  alias Backend.Accounts.User
  alias Backend.Repo

  # A token is only valid for as long as generate_user_token/1's own auth
  # tokens (Accounts.@token_max_age) — reusing the same 24h window rather
  # than inventing a second one, even though this is a conceptually
  # separate value (an email link's lifetime, not a signed auth token's).
  @token_ttl_seconds 60 * 60 * 24

  @generic_resend_message "E-posta adresiniz sistemde kayıtlıysa, doğrulama bağlantısı gönderildi"

  # Same brute-force guard as UserController's register/login (see its own
  # comment) — resend-verification is just as attractive a target for an
  # email-enumeration or mail-bombing attempt, so it gets the identical
  # 5/minute, IP + {:param, "email"} limit.
  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 5] when action in [:resend]

  @doc """
  GET /api/verify-email/:token — flips `email_verified` on for the user
  whose (unhashed, see `Accounts.generate_email_verification_token/1`)
  token matches. Deliberately does not require authentication: the token
  itself, mailed only to the account's own address, is the proof.
  """
  def verify(conn, %{"token" => token}) do
    case Repo.get_by(User, email_verification_token: token) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "invalid_token"})

      %User{} = user ->
        if token_expired?(user) do
          conn |> put_status(:gone) |> json(%{error: "token_expired"})
        else
          {:ok, _updated} =
            user
            |> Ecto.Changeset.change(email_verified: true, email_verification_token: nil)
            |> Repo.update()

          json(conn, %{message: "E-posta doğrulandı"})
        end
    end
  end

  @doc """
  POST /api/resend-verification — issues a fresh token/email for an
  unverified account, identified by "email". Always returns the same
  generic success message regardless of whether that email belongs to an
  account, is already verified, or doesn't exist at all — anything else
  would let a caller enumerate registered/unverified addresses one probe
  at a time (same reasoning as `Accounts.authenticate_user/2`'s constant
  response shape for a wrong password vs. no such user).
  """
  def resend(conn, %{"email" => email}) do
    case Accounts.get_user_by_email(email) do
      %User{email_verified: false} = user -> :ok = Accounts.send_verification_email(user)
      _ -> :ok
    end

    json(conn, %{message: @generic_resend_message})
  end

  def resend(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "email gerekli"})
  end

  defp token_expired?(%User{email_verification_sent_at: nil}), do: true

  defp token_expired?(%User{email_verification_sent_at: sent_at}) do
    DateTime.diff(DateTime.utc_now(), sent_at, :second) > @token_ttl_seconds
  end
end
