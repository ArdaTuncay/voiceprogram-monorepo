defmodule BackendWeb.TwoFactorController do
  @moduledoc """
  Two-factor sign-in settings for the signed-in user (see
  `Backend.Accounts.TwoFactor`): status, set up, turn on with a code, turn
  off with the password and a code. Setting up and turning off take the
  current password, like every other sensitive account change.
  """
  use BackendWeb, :controller

  alias Backend.Accounts
  alias Backend.Accounts.TwoFactor

  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 10, key: :current_user]
       when action in [:setup, :enable, :disable]

  @doc "GET /api/account/2fa"
  def show(conn, _params), do: json(conn, TwoFactor.status(conn.assigns.current_user))

  @doc "POST /api/account/2fa/setup — `current_password`; returns the secret, QR code and setup token."
  def setup(conn, %{"current_password" => password}) do
    with_password(conn, password, fn user -> json(conn, TwoFactor.setup(user)) end)
  end

  def setup(conn, _params), do: missing(conn, "current_password gerekli")

  @doc "POST /api/account/2fa/enable — `setup_token` and a `code`; returns the recovery codes."
  def enable(conn, %{"setup_token" => setup_token, "code" => code}) do
    case TwoFactor.enable(conn.assigns.current_user, setup_token, code) do
      {:ok, codes} ->
        json(conn, %{recovery_codes: codes})

      {:error, :invalid_setup} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: gettext("The setup has expired, please start again")})

      {:error, :invalid_code} ->
        invalid_code(conn)
    end
  end

  def enable(conn, _params), do: missing(conn, "setup_token ve code gerekli")

  @doc "POST /api/account/2fa/disable — `current_password` and a `code` (or a recovery code)."
  def disable(conn, %{"current_password" => password, "code" => code}) do
    with_password(conn, password, fn user ->
      case TwoFactor.disable(user, code) do
        :ok -> send_resp(conn, :no_content, "")
        {:error, :invalid_code} -> invalid_code(conn)
      end
    end)
  end

  def disable(conn, _params), do: missing(conn, "current_password ve code gerekli")

  defp with_password(conn, password, fun) do
    user = conn.assigns.current_user

    if Accounts.verify_password?(user, password) do
      fun.(user)
    else
      conn
      |> put_status(:forbidden)
      |> json(%{error: gettext("Current password is incorrect")})
    end
  end

  defp invalid_code(conn) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: gettext("Invalid or expired code")})
  end

  defp missing(conn, message), do: conn |> put_status(:bad_request) |> json(%{error: message})
end
