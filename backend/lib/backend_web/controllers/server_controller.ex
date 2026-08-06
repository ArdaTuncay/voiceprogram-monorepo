defmodule BackendWeb.ServerController do
  use BackendWeb, :controller

  alias Backend.Chat
  alias Backend.Servers
  alias Backend.Servers.Server

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

  @doc "POST /api/servers/:server_id/channels — creates a text, voice, or category channel. Owner only."
  def create_channel(conn, %{"server_id" => server_id} = params) do
    with %Server{} = server <- Servers.get_server(server_id),
         true <- Servers.owner?(server.id, conn.assigns.current_user.id) do
      case Servers.create_channel(server.id, params) do
        {:ok, channel} ->
          conn
          |> put_status(:created)
          |> json(channel_json(channel))

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

  @doc """
  PATCH /api/servers/:server_id/channels/positions — bulk-updates channel
  `parent_id`/`position` (moving a channel into/out of a category,
  reordering siblings). Owner only.
  """
  def update_channel_positions(conn, %{"server_id" => server_id, "channels" => channels_params}) do
    with %Server{} = server <- Servers.get_server(server_id),
         true <- Servers.owner?(server.id, conn.assigns.current_user.id) do
      updates = Enum.map(channels_params, &normalize_position_update/1)

      case Servers.update_channel_positions(server.id, updates) do
        {:ok, channels} ->
          json(conn, Enum.map(channels, &channel_json/1))

        {:error, :not_found} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: "One or more channels not found"})

        {:error, %Ecto.Changeset{} = changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
    else
      false -> forbidden(conn)
      nil -> not_found(conn)
    end
  end

  defp normalize_position_update(%{"id" => id} = params) do
    %{id: id, parent_id: Map.get(params, "parent_id"), position: Map.get(params, "position", 0)}
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
      do_delete_member(conn, server, user_id)
    else
      false -> forbidden(conn)
      nil -> not_found(conn)
    end
  end

  defp do_delete_member(conn, server, user_id) do
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
  end

  @doc "DELETE /api/servers/:server_id/leave — leaves a server. Any member except the owner."
  def leave(conn, %{"server_id" => server_id}) do
    case Servers.leave_server(server_id, conn.assigns.current_user.id) do
      {:ok, _} ->
        send_resp(conn, :no_content, "")

      {:error, :owner_cannot_leave} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Server owner cannot leave — delete the server instead"})

      {:error, :not_found} ->
        not_found(conn)
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
    base = %{
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parent_id: channel.parent_id,
      position: channel.position
    }

    # Only voice channels can have anyone "in" them at all — a text/category
    # channel just never gets the field, rather than always shipping an
    # always-empty `voice_occupants: []` that would never mean anything for
    # those types. N+1 (one Presence.list/1 per voice channel) — same
    # accepted-tradeoff pattern already used elsewhere in this codebase
    # (e.g. unread counts).
    if channel.type == "voice" do
      Map.put(base, :voice_occupants, Chat.voice_occupants(channel.id))
    else
      base
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
