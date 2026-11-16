defmodule BackendWeb.AuthPlug do
  @moduledoc """
  Authenticates a request's `Authorization: Bearer <token>` header (see
  `Backend.Accounts.authenticate_session/1`), assigning `:current_user` and
  `:current_session_id` on success or halting with 401 on failure.
  """

  use Gettext, backend: BackendWeb.Gettext

  import Plug.Conn

  alias Backend.Accounts

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, user, session_id} <- Accounts.authenticate_session(token) do
      conn
      |> assign(:current_user, user)
      # nil for a token issued before sessions existed.
      |> assign(:current_session_id, session_id)
    else
      _ ->
        conn
        |> put_status(:unauthorized)
        |> Phoenix.Controller.json(%{error: gettext("Unauthorized")})
        |> halt()
    end
  end
end
