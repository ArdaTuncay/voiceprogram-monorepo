defmodule BackendWeb.EmailChangeController do
  use BackendWeb, :controller

  alias Backend.Accounts

  # The token is a 256-bit secret, so this only keeps a script from
  # hammering the endpoint.
  plug BackendWeb.RateLimiterPlug, [scale: :timer.minutes(1), limit: 10] when action in [:confirm]

  @doc """
  POST /api/account/email/confirm — applies a pending email change from
  the link mailed to the new address (see
  `Accounts.confirm_email_change/1`). Unauthenticated on purpose: the
  token is the proof, and the link may well be opened in a browser where
  the user isn't signed in.
  """
  def confirm(conn, %{"token" => token}) when is_binary(token) do
    case Accounts.confirm_email_change(token) do
      {:ok, user} ->
        json(conn, %{message: "E-posta adresiniz güncellendi", email: user.email})

      {:error, :invalid_token} ->
        conn |> put_status(:not_found) |> json(%{error: "invalid_token"})

      {:error, :token_expired} ->
        conn |> put_status(:gone) |> json(%{error: "token_expired"})

      {:error, %Ecto.Changeset{} = changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  def confirm(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "token gerekli"})
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
