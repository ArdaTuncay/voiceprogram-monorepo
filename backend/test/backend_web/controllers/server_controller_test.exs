defmodule BackendWeb.ServerControllerTest do
  use BackendWeb.ConnCase, async: true

  alias Backend.Servers

  describe "GET /api/servers/:id/channels" do
    test "a voice channel's response includes voice_occupants, a text channel's doesn't", %{
      conn: conn
    } do
      owner = user_fixture()
      server = server_fixture(owner)

      {:ok, voice_channel} =
        Servers.create_channel(server.id, %{"name" => "ses", "type" => "voice"})

      conn =
        conn
        |> put_req_header("authorization", "Bearer #{token_for(owner)}")
        |> get(~p"/api/servers/#{server.id}/channels")

      channels = json_response(conn, 200)

      voice_json = Enum.find(channels, &(&1["id"] == voice_channel.id))
      assert voice_json["voice_occupants"] == []

      text_json = Enum.find(channels, &(&1["type"] == "text"))
      refute Map.has_key?(text_json, "voice_occupants")
    end

    test "voice_occupants reflects who's actually connected to that voice room right now", %{
      conn: conn
    } do
      owner = user_fixture()
      server = server_fixture(owner)

      {:ok, voice_channel} =
        Servers.create_channel(server.id, %{"name" => "ses", "type" => "voice"})

      {:ok, _} =
        Backend.Presence.track(self(), "voice:#{voice_channel.id}", owner.id, %{
          username: owner.username
        })

      conn =
        conn
        |> put_req_header("authorization", "Bearer #{token_for(owner)}")
        |> get(~p"/api/servers/#{server.id}/channels")

      channels = json_response(conn, 200)
      voice_json = Enum.find(channels, &(&1["id"] == voice_channel.id))

      assert voice_json["voice_occupants"] == [
               %{"user_id" => owner.id, "username" => owner.username}
             ]
    end
  end
end
