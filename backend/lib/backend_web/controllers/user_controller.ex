defmodule BackendWeb.UserController do
  use BackendWeb, :controller

  alias Backend.Accounts

  # Brute-force guard — see BackendWeb.RateLimiterPlug. Limited to these two
  # actions only; every other controller is unaffected.
  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 5] when action in [:login, :register]

  def register(conn, params) do
    case Accounts.create_user(params) do
      {:ok, user} ->
        conn
        |> put_status(:created)
        |> json(%{
          id: user.id,
          username: user.username,
          email: user.email,
          token: Accounts.generate_user_token(user)
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  def login(conn, %{"email" => email, "password" => password}) do
    case Accounts.authenticate_user(email, password) do
      {:ok, user} ->
        json(conn, %{
          id: user.id,
          username: user.username,
          email: user.email,
          token: Accounts.generate_user_token(user)
        })

      {:error, _} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Invalid email or password"})
    end
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
    BackendWeb.Endpoint.broadcast("user_socket:#{user.id}", "disconnect", %{})
    send_resp(conn, :no_content, "")
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
