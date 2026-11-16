defmodule BackendWeb.DeviceInfo do
  @moduledoc """
  What a session records about the device it was opened from (see
  `Backend.Accounts.Session`): the browser's user agent and the client IP.
  `conn.remote_ip` is already the real client's address here — see
  `RemoteIp`/`BackendWeb.RequireCloudflarePlug` in endpoint.ex.
  """

  @spec from_conn(Plug.Conn.t()) :: %{user_agent: String.t() | nil, ip: String.t()}
  def from_conn(conn) do
    user_agent =
      case Plug.Conn.get_req_header(conn, "user-agent") do
        [ua | _] -> ua
        [] -> nil
      end

    %{user_agent: user_agent, ip: conn.remote_ip |> :inet.ntoa() |> to_string()}
  end
end
