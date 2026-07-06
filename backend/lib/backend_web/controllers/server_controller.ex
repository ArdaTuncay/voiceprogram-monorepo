defmodule BackendWeb.ServerController do
  use BackendWeb, :controller

  alias Backend.Servers
  alias Backend.Servers.Server
  alias Backend.Chat

  def index(conn, _params) do
    servers = Servers.list_servers_for_user(conn.assigns.current_user.id)
    json(conn, Enum.map(servers, &server_json/1))
  end

  def create(conn, params) do
    case Servers.create_server(params, conn.assigns.current_user.id) do
      {:ok, server} ->
        conn
        |> put_status(:created)
        |> json(server_json(server))

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  def channels(conn, %{"id" => server_id}) do
    with %Server{} = server <- Servers.get_server(server_id),
         true <- Servers.member?(server.id, conn.assigns.current_user.id) do
      channels = Chat.list_channels_for_server(server.id)
      json(conn, Enum.map(channels, &channel_json/1))
    else
      _ ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Server not found"})
    end
  end

  def members(conn, %{"id" => server_id}) do
    with %Server{} = server <- Servers.get_server(server_id),
         true <- Servers.member?(server.id, conn.assigns.current_user.id) do
      json(conn, Servers.list_members(server.id))
    else
      _ ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Server not found"})
    end
  end

  @doc "PUT /api/servers/:id — renames a server. Owner only."
  def update(conn, %{"id" => server_id} = params) do
    with %Server{} = server <- Servers.get_server(server_id),
         true <- Servers.owner?(server.id, conn.assigns.current_user.id) do
      case Servers.update_server(server, params) do
        {:ok, updated} ->
          json(conn, server_json(updated))

        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
    else
      false -> forbidden(conn)
      nil -> not_found(conn)
    end
  end

  @doc "DELETE /api/servers/:id — permanently deletes a server. Owner only."
  def delete(conn, %{"id" => server_id}) do
    with %Server{} = server <- Servers.get_server(server_id),
         true <- Servers.owner?(server.id, conn.assigns.current_user.id) do
      {:ok, _} = Servers.delete_server(server)
      send_resp(conn, :no_content, "")
    else
      false -> forbidden(conn)
      nil -> not_found(conn)
    end
  end

  @doc "DELETE /api/servers/:server_id/members/:user_id — kicks a member. Owner only."
  def delete_member(conn, %{"server_id" => server_id, "user_id" => user_id}) do
    with %Server{} = server <- Servers.get_server(server_id),
         true <- Servers.owner?(server.id, conn.assigns.current_user.id) do
      if user_id == server.owner_id do
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Cannot kick the server owner"})
      else
        case Servers.kick_member(server.id, user_id) do
          {:ok, _} ->
            send_resp(conn, :no_content, "")

          {:error, :not_found} ->
            conn
            |> put_status(:not_found)
            |> json(%{error: "Member not found"})
        end
      end
    else
      false -> forbidden(conn)
      nil -> not_found(conn)
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

  defp server_json(server) do
    %{id: server.id, name: server.name, owner_id: server.owner_id}
  end

  defp channel_json(channel) do
    %{id: channel.id, name: channel.name, type: channel.type}
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
