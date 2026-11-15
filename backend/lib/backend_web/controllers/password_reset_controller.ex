defmodule BackendWeb.PasswordResetController do
  use BackendWeb, :controller

  alias Backend.Accounts

  @generic_message "E-posta adresiniz sistemde kayıtlıysa, şifre sıfırlama bağlantısı gönderildi"

  # Requesting a reset sends mail — guarded like register/login/resend
  # (5/minute, per IP and per "email"), against mail-bombing and probing.
  plug BackendWeb.RateLimiterPlug, [scale: :timer.minutes(1), limit: 5] when action in [:create]

  # Confirming is a guess at a 256-bit token, so brute force is hopeless
  # anyway; this just keeps a script from hammering the endpoint.
  plug BackendWeb.RateLimiterPlug, [scale: :timer.minutes(1), limit: 10] when action in [:confirm]

  @doc """
  POST /api/password-reset — emails a reset link if `email` belongs to an
  account. The response is the same either way (see
  `Accounts.request_password_reset/1`).
  """
  def create(conn, %{"email" => email}) when is_binary(email) do
    :ok = Accounts.request_password_reset(email)
    json(conn, %{message: @generic_message})
  end

  def create(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "email gerekli"})
  end

  @doc """
  POST /api/password-reset/confirm — sets a new password using the token
  from the emailed link.
  """
  def confirm(conn, %{"token" => token, "password" => password})
      when is_binary(token) and is_binary(password) do
    case Accounts.reset_password(token, password) do
      {:ok, _user} ->
        json(conn, %{message: "Şifreniz güncellendi, yeni şifrenizle giriş yapabilirsiniz"})

      {:error, :invalid_token} ->
        conn |> put_status(:not_found) |> json(%{error: "invalid_token"})

      {:error, :token_expired} ->
        conn |> put_status(:gone) |> json(%{error: "token_expired"})

      {:error, %Ecto.Changeset{} = changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  def confirm(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "token ve password gerekli"})
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
