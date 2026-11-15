defmodule BackendWeb.ServerChannel do
  @moduledoc """
  Each server's shared `"server:<id>"` broadcast topic — see the `join/3`
  doc below for what gets broadcast here and why.
  """

  use Phoenix.Channel

  alias Backend.Servers
  alias Backend.Servers.Server

  # A server's shared topic — every member currently viewing this server
  # joins it, so server-wide events (channel created/deleted, server
  # renamed, member left/kicked) are broadcast here ONCE instead of fanned
  # out to each member's personal "user:<id>" topic individually (see
  # Backend.Servers). Purely a broadcast relay: the client never pushes
  # anything to it, so there's no handle_in.
  @impl true
  def join("server:" <> server_id, _params, socket) do
    case Servers.get_server(server_id) do
      nil ->
        {:error, %{reason: "server not found"}}

      %Server{} = server ->
        # Subscribed before the membership check, not after — see
        # Servers.subscribe_to_membership/2.
        :ok = Servers.subscribe_to_membership(server.id, socket.assigns.user_id)

        if Servers.member?(server.id, socket.assigns.user_id) do
          {:ok, socket}
        else
          {:error, %{reason: "not authorized"}}
        end
    end
  end

  # See Servers.revoke_channel_access/2 — stops a removed member from
  # receiving this server's live updates (channel list, member list,
  # voice occupancy) on an already-open process.
  @impl true
  def handle_info({:server_membership_revoked, server_id}, socket) do
    push(socket, "access_revoked", %{server_id: server_id})
    {:stop, {:shutdown, :membership_revoked}, socket}
  end
end
