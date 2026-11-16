defmodule BackendWeb.UserController do
  use BackendWeb, :controller

  alias Backend.Accounts
  alias Backend.Accounts.TwoFactor

  # Brute-force guard — see BackendWeb.RateLimiterPlug. Limited to these two
  # actions only; every other controller is unaffected.
  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 5] when action in [:login, :register]

  # Per IP; TwoFactor.verify_challenge/2 also limits attempts per account.
  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 10] when action in [:login_two_factor]

  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 10, key: :current_user] when action in [:renew_token]

  @doc """
  Registers a new user. No longer logs the caller in — see
  `Backend.Accounts.User`'s `email_verified` column: an account starts
  unverified, and `login/2` below refuses to issue a token until it is.
  Sending the verification email (via `Accounts.send_verification_email/1`)
  can never fail this request; a mail-provider outage still leaves the
  account created, just without (yet) a delivered link — the user can
  always ask for another one via `POST /api/resend-verification`.
  """
  def register(conn, params) do
    case Accounts.create_user(params) do
      {:ok, user} ->
        :ok = Accounts.send_verification_email(user)

        conn
        |> put_status(:created)
        |> json(%{
          message:
            gettext("Registration successful, please check your email to verify your account"),
          email_verification_required: true
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  def login(conn, %{"email" => email, "password" => password}) do
    case Accounts.authenticate_user(email, password) do
      {:ok, %{email_verified: false}} ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "email_not_verified"})

      {:ok, user} ->
        if TwoFactor.enabled?(user) do
          # No session yet: the password was right, the code is still to come.
          json(conn, %{two_factor: true, challenge: TwoFactor.challenge(user)})
        else
          json(conn, signed_in(conn, user))
        end

      {:error, _} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: gettext("Invalid email or password")})
    end
  end

  @doc """
  POST /api/users/login/2fa — the second step of a two-factor sign-in: the
  challenge `login/2` returned plus a current code (or a recovery code).
  Same reply as a plain sign-in. See `Backend.Accounts.TwoFactor`.
  """
  def login_two_factor(conn, %{"challenge" => challenge, "code" => code}) do
    case TwoFactor.verify_challenge(challenge, code) do
      {:ok, user} ->
        json(conn, signed_in(conn, user))

      {:error, :too_many_attempts} ->
        conn
        |> put_status(:too_many_requests)
        |> json(%{error: gettext("Too many attempts. Please try again later.")})

      {:error, _} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: gettext("Invalid or expired code")})
    end
  end

  def login_two_factor(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "challenge ve code gerekli"})
  end

  defp signed_in(conn, user) do
    %{
      id: user.id,
      username: user.username,
      email: user.email,
      avatar_url: user.avatar_url,
      token: Accounts.generate_user_token(user, BackendWeb.DeviceInfo.from_conn(conn))
    }
  end

  @doc """
  Logs the current user out of every device: bumps `token_valid_from` (so
  every previously issued token, including the one used for this very
  request, stops passing `Accounts.authenticate_token/1`) and disconnects
  any live WebSocket connections immediately rather than waiting for them
  to notice on their next authenticated request.
  """
  def logout_all(conn, _params) do
    user = conn.assigns.current_user
    {:ok, _user} = Accounts.revoke_all_tokens(user)
    send_resp(conn, :no_content, "")
  end

  @doc """
  POST /api/users/renew-token — swaps the caller's still-valid token for a
  fresh 7-day one (see `Accounts.renew_user_token/1`). The frontend calls it
  on app start and every 12 hours while open.
  """
  def renew_token(conn, _params) do
    token =
      Accounts.renew_user_token(
        conn.assigns.current_user,
        conn.assigns.current_session_id,
        BackendWeb.DeviceInfo.from_conn(conn)
      )

    json(conn, %{token: token})
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
