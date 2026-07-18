defmodule Backend.Release do
  @moduledoc """
  Tasks for running in a compiled release, where `mix` isn't available.
  Invoked via `bin/migrate`/`bin/healthcheck` (see rel/overlays/bin/).
  """

  @app :backend

  @doc """
  Used by Dockerfile's HEALTHCHECK via `bin/healthcheck` (see
  rel/overlays/bin/healthcheck) — every invocation of `RELEASE_NAME eval`
  (unlike `RELEASE_NAME rpc`) boots its own short-lived, separate BEAM
  instance rather than reaching into the already-running server's node, so
  `System.halt/1` below only ever exits *this* throwaway health-check
  process. Calling System.halt from an `rpc`-evaluated expression instead
  would halt the real, running production node — a mistake worth spelling
  out explicitly since the two release commands look interchangeable at a
  glance but very much aren't here.

  Makes a real HTTP request to the already-running server's own
  `GET /api/healthz` (see BackendWeb.HealthController, which is what
  actually checks the database) over a raw `:gen_tcp` socket rather than
  querying the database directly in this throwaway process — `:gen_tcp` is
  part of `:kernel` (always available, no extra OTP app/dep needed), and
  going over HTTP means a failure here also catches the HTTP listener
  itself being wedged/unresponsive, not just a dead DB connection.
  """
  @spec health_check() :: no_return()
  def health_check do
    port = System.get_env("PORT", "4000") |> String.to_integer()

    ok? =
      with {:ok, socket} <-
             :gen_tcp.connect(~c"localhost", port, [:binary, active: false], 2_000),
           :ok <-
             :gen_tcp.send(
               socket,
               "GET /api/healthz HTTP/1.1\r\nHost: localhost\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
             ),
           {:ok, response} <- :gen_tcp.recv(socket, 0, 2_000) do
        :gen_tcp.close(socket)
        String.starts_with?(response, "HTTP/1.1 200")
      else
        _ -> false
      end

    System.halt(if ok?, do: 0, else: 1)
  end

  def migrate do
    load_app()

    for repo <- repos() do
      {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end
  end

  def rollback(repo, version) do
    load_app()
    {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :down, to: version))
  end

  defp repos do
    Application.fetch_env!(@app, :ecto_repos)
  end

  defp load_app do
    Application.load(@app)
  end
end
