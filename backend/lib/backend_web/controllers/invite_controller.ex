defmodule BackendWeb.InviteController do
  use BackendWeb, :controller

  alias Backend.Servers
  alias Backend.Servers.Server

  # Caps invite-code creation per server (see BackendWeb.RateLimiterPlug) —
  # keyed by the "server_id" path param alongside the usual per-IP limit,
  # so spamming invite creation for one server is bounded even from
  # multiple IPs.
  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 10, key: {:param, "server_id"}] when action in [:create]

  @doc "POST /api/servers/:server_id/invites — creates a new invite code for the server."
  def create(conn, %{"server_id" => server_id} = params) do
    with %Server{} = server <- Servers.get_server(server_id),
         true <- Servers.member?(server.id, conn.assigns.current_user.id),
         {:ok, attrs} <- parse_invite_attrs(params) do
      case Servers.create_invite(server.id, conn.assigns.current_user.id, attrs) do
        {:ok, invite} ->
          conn
          |> put_status(:created)
          |> json(invite_json(invite))

        {:error, :code_generation_failed} ->
          conn
          |> put_status(:internal_server_error)
          |> json(%{error: "Could not generate a unique invite code, please try again"})

        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
    else
      {:error, :invalid_expires_at} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "expires_at must be a valid ISO8601 datetime"})

      {:error, :invalid_max_uses} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "max_uses must be a positive integer"})

      _ ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Server not found"})
    end
  end

  @doc "GET /api/servers/:server_id/invites — lists every invite for the server. Owner only."
  def index(conn, %{"server_id" => server_id}) do
    with %Server{} = server <- Servers.get_server(server_id),
         true <- Servers.owner?(server.id, conn.assigns.current_user.id) do
      json(conn, Enum.map(Servers.list_invites(server.id), &invite_json/1))
    else
      false -> forbidden(conn)
      _ -> not_found(conn)
    end
  end

  @doc "DELETE /api/servers/:server_id/invites/:id — revokes an invite. Owner only."
  def delete(conn, %{"server_id" => server_id, "id" => invite_id}) do
    with %Server{} = server <- Servers.get_server(server_id),
         true <- Servers.owner?(server.id, conn.assigns.current_user.id) do
      case Servers.revoke_invite(invite_id, server.id) do
        {:ok, _} ->
          send_resp(conn, :no_content, "")

        {:error, :not_found} ->
          conn |> put_status(:not_found) |> json(%{error: "Invite not found"})
      end
    else
      false -> forbidden(conn)
      _ -> not_found(conn)
    end
  end

  defp forbidden(conn) do
    conn
    |> put_status(:forbidden)
    |> json(%{error: "Only the server owner can perform this action"})
  end

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(%{error: "Server not found"})
  end

  @doc "POST /api/invites/:code/accept — redeems an invite code for the current user."
  def accept(conn, %{"code" => code}) do
    case Servers.accept_invite(code, conn.assigns.current_user.id) do
      {:ok, server} ->
        json(conn, %{id: server.id, name: server.name, owner_id: server.owner_id})

      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "Invite not found"})

      {:error, :expired} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Invite has expired"})

      {:error, :max_uses_reached} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Invite has reached its maximum number of uses"})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  defp parse_invite_attrs(params) do
    with {:ok, expires_at} <- parse_expires_at(params["expires_at"]),
         {:ok, max_uses} <- parse_max_uses(params["max_uses"]) do
      {:ok, %{expires_at: expires_at, max_uses: max_uses}}
    end
  end

  defp parse_expires_at(nil), do: {:ok, nil}
  defp parse_expires_at(""), do: {:ok, nil}

  defp parse_expires_at(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, datetime, _offset} -> {:ok, DateTime.truncate(datetime, :second)}
      {:error, _} -> {:error, :invalid_expires_at}
    end
  end

  defp parse_expires_at(_), do: {:error, :invalid_expires_at}

  defp parse_max_uses(nil), do: {:ok, nil}
  defp parse_max_uses(""), do: {:ok, nil}
  defp parse_max_uses(value) when is_integer(value) and value > 0, do: {:ok, value}

  defp parse_max_uses(value) when is_binary(value) do
    case Integer.parse(value) do
      {int, ""} when int > 0 -> {:ok, int}
      _ -> {:error, :invalid_max_uses}
    end
  end

  defp parse_max_uses(_), do: {:error, :invalid_max_uses}

  defp invite_json(invite) do
    %{
      id: invite.id,
      code: invite.code,
      server_id: invite.server_id,
      expires_at: invite.expires_at,
      max_uses: invite.max_uses,
      uses_count: invite.uses_count
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
