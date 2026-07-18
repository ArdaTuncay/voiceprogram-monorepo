defmodule Backend.Application do
  # See https://elixir.hexdocs.pm/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  require Logger

  @impl true
  def start(_type, _args) do
    # Attaches the Sentry.LoggerHandler registered under `config :backend,
    # :logger` (see config/config.exs) — must happen before anything else
    # starts so crashes during boot are caught too, not just ones after the
    # supervision tree is up.
    Logger.add_handlers(:backend)
    Backend.SlowQueryLogger.attach()

    if Application.get_env(:backend, :database_ssl_verify) == :verify_none do
      Logger.warning(
        "Postgres SSL sertifika doğrulaması DEVRE DIŞI (DATABASE_SSL_VERIFY=verify_none) — bu üretimde MITM riski taşır, sadece sağlayıcınız verify_peer'i desteklemiyorsa kullanın."
      )
    end

    children = [
      BackendWeb.Telemetry,
      Backend.Repo,
      {DNSCluster, query: Application.get_env(:backend, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Backend.PubSub},
      Backend.Presence,
      {Backend.RateLimiter, Application.get_env(:backend, Backend.RateLimiter, [])},
      # Start a worker by calling: Backend.Worker.start_link(arg)
      # {Backend.Worker, arg},
      # Start to serve requests, typically the last entry
      BackendWeb.Endpoint
    ]

    # See https://elixir.hexdocs.pm/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Backend.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    BackendWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
