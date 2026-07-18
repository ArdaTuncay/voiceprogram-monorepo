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
        if Servers.member?(server.id, socket.assigns.user_id) do
          {:ok, socket}
        else
          {:error, %{reason: "not authorized"}}
        end
    end
  end
end
