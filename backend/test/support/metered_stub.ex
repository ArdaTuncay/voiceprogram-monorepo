defmodule Backend.MeteredStub do
  @moduledoc """
  Stands in for Metered's TURN REST API in tests (via `Req.Test`, see
  config/test.exs). Every credential it creates is numbered, so tests can
  tell a reused credential from a freshly created one, and it reports each
  create call to the test process as
  `{:metered_create, host, query_params, json_body}`.
  """

  @secret_key "test-secret-key-must-never-be-logged"

  def secret_key, do: @secret_key

  @doc """
  Configures per-user Metered mode for the current test and restores the
  previous `:metered_api`/`:turn_config` on exit. Pass `static: true` to
  also configure the old static credential pair (the fallback).
  """
  def configure(opts \\ []) do
    previous = {
      Application.get_env(:backend, :metered_api),
      Application.get_env(:backend, :turn_config)
    }

    ExUnit.Callbacks.on_exit(fn ->
      {metered, turn} = previous
      put_or_delete(:metered_api, metered)
      put_or_delete(:turn_config, turn)
    end)

    Application.put_env(:backend, :metered_api, %{
      app_name: "zircle-test",
      secret_key: @secret_key
    })

    if opts[:static] do
      Application.put_env(:backend, :turn_config, %{username: "static-u", credential: "static-c"})
    else
      Application.delete_env(:backend, :turn_config)
    end

    :ok
  end

  @doc "A working Metered API."
  def stub_ok do
    test_pid = self()

    Req.Test.stub(Backend.Turn.Metered, fn conn ->
      conn = Plug.Conn.fetch_query_params(conn)

      case {conn.method, conn.request_path} do
        {"POST", "/api/v1/turn/credential"} ->
          {:ok, body, conn} = Plug.Conn.read_body(conn)
          n = System.unique_integer([:positive])
          send(test_pid, {:metered_create, conn.host, conn.query_params, Jason.decode!(body)})

          Req.Test.json(conn, %{
            "username" => "user#{n}",
            "password" => "pass#{n}",
            "expiryInSeconds" => 172_800,
            "label" => "ignored",
            "apiKey" => "key#{n}"
          })

        {"GET", "/api/v1/turn/credentials"} ->
          n = String.replace_prefix(conn.query_params["apiKey"], "key", "")

          Req.Test.json(conn, [
            %{
              "urls" => "turn:standard.relay.metered.ca:80",
              "username" => "user#{n}",
              "credential" => "pass#{n}"
            },
            %{
              "urls" => "turn:standard.relay.metered.ca:443?transport=tcp",
              "username" => "user#{n}",
              "credential" => "pass#{n}",
              "extra" => "dropped"
            }
          ])
      end
    end)
  end

  @doc "A Metered API that answers every call with `status` and `body`."
  def stub_failing(status, body) do
    Req.Test.stub(Backend.Turn.Metered, fn conn ->
      conn |> Plug.Conn.put_status(status) |> Req.Test.json(body)
    end)
  end

  @doc "The ICE server entries `stub_ok/0` returns for credential `username`."
  def servers_for("user" <> n) do
    [
      %{
        "urls" => "turn:standard.relay.metered.ca:80",
        "username" => "user#{n}",
        "credential" => "pass#{n}"
      },
      %{
        "urls" => "turn:standard.relay.metered.ca:443?transport=tcp",
        "username" => "user#{n}",
        "credential" => "pass#{n}"
      }
    ]
  end

  defp put_or_delete(key, nil), do: Application.delete_env(:backend, key)
  defp put_or_delete(key, value), do: Application.put_env(:backend, key, value)
end
