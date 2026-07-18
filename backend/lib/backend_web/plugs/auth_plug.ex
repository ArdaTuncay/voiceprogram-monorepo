defmodule BackendWeb.AuthPlug do
  @moduledoc """
  Authenticates a request's `Authorization: Bearer <token>` header (see
  `Backend.Accounts.authenticate_token/1`), assigning `:current_user` on
  success or halting with 401 on failure.
  """

  import Plug.Conn

  alias Backend.Accounts

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, user} <- Accounts.authenticate_token(token) do
      assign(conn, :current_user, user)
    else
      _ ->
        conn
        |> put_status(:unauthorized)
        |> Phoenix.Controller.json(%{error: "Unauthorized"})
        |> halt()
    end
  end
end
