# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :backend,
  ecto_repos: [Backend.Repo],
  generators: [timestamp_type: :utc_datetime, binary_id: true]

config :backend, Backend.Repo,
  migration_primary_key: [type: :binary_id],
  migration_foreign_key: [type: :binary_id]

# Chat attachment storage — :local (disk, dev default) or :s3 (see
# Backend.Uploads.S3). Overridden per-environment; see config/runtime.exs
# for the production S3/R2 setup and config/dev.exs for testing it locally.
config :backend, :uploads, adapter: :local

# ETS housekeeping for Backend.RateLimiter (see BackendWeb.RateLimiterPlug) —
# how often expired rate-limit counters are swept, and how old an entry can
# get before it's considered stale. Single-node ETS is fine for both dev and
# the current one-instance production deployment, so this isn't split across
# dev.exs/runtime.exs.
config :backend, Backend.RateLimiter,
  clean_period: :timer.minutes(1),
  key_older_than: :timer.minutes(10)

# Configure the endpoint
config :backend, BackendWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: BackendWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Backend.PubSub,
  live_view: [signing_salt: "f2Rl0Bk/"]

# Configure the mailer
#
# By default it uses the "Local" adapter which stores the emails
# locally. You can see the emails in your browser, at "/dev/mailbox".
#
# For production it's recommended to configure a different adapter
# at the `config/runtime.exs`.
config :backend, Backend.Mailer, adapter: Swoosh.Adapters.Local

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Sends unhandled exceptions and process crashes (not just explicit
# `Logger.error` calls) to Sentry — see Backend.Application, which calls
# `Logger.add_handlers(:backend)` to actually attach this at boot. Safe to
# register in every environment: Sentry itself no-ops with no DSN
# configured (see config/runtime.exs, which only sets one in prod).
config :backend, :logger, [
  {:handler, :sentry_handler, Sentry.LoggerHandler,
   %{config: %{metadata: [:file, :line, :request_id], capture_log_messages: true}}}
]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
