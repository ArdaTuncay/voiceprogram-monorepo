import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# ## Using releases
#
# If you use `mix release`, you need to explicitly enable the server
# by passing the PHX_SERVER=true when you start it:
#
#     PHX_SERVER=true bin/backend start
#
# Alternatively, you can use `mix phx.gen.release` to generate a `bin/server`
# script that automatically sets the env var above.
if System.get_env("PHX_SERVER") do
  config :backend, BackendWeb.Endpoint, server: true
end

config :backend, BackendWeb.Endpoint,
  http: [port: String.to_integer(System.get_env("PORT", "4000"))]

# Exposed at runtime (not just compile-time Mix.env()) so plugs like
# BackendWeb.SecurityHeadersPlug can gate environment-specific behavior
# (e.g. HSTS, which must never be sent in dev) via Application.get_env
# instead of baking Mix.env() into the compiled build.
config :backend, :environment, config_env()

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
      For example: ecto://USER:PASS@HOST/DATABASE
      """

  maybe_ipv6 = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []

  # Defaults to verify_peer (the safe side) so a missing env var can't
  # silently disable certificate verification. Only set DATABASE_SSL_VERIFY
  # to verify_none if the provider's Postgres genuinely doesn't offer a
  # verifiable CA chain — see the Logger.warning in Backend.Application for
  # the runtime reminder that this is happening.
  database_ssl_verify =
    case System.get_env("DATABASE_SSL_VERIFY", "verify_peer") do
      "verify_peer" ->
        :verify_peer

      "verify_none" ->
        :verify_none

      other ->
        raise """
        geçersiz DATABASE_SSL_VERIFY değeri: #{inspect(other)}.
        Kabul edilen değerler: "verify_peer" (varsayılan) veya "verify_none".
        """
    end

  ssl_opts =
    case database_ssl_verify do
      :verify_peer ->
        db_host = database_url |> URI.parse() |> Map.fetch!(:host)

        # No DATABASE_CA_CERT_FILE means fall back to the OS/Erlang trust
        # store bundled with OTP (public_key.cacerts_get/0, available since
        # OTP 25 — this project targets OTP 29, see backend/Dockerfile).
        cacert_opt =
          case System.get_env("DATABASE_CA_CERT_FILE") do
            nil -> [cacerts: :public_key.cacerts_get()]
            path -> [cacertfile: path]
          end

        [verify: :verify_peer, server_name_indication: String.to_charlist(db_host)] ++
          cacert_opt

      :verify_none ->
        [verify: :verify_none]
    end

  config :backend, :database_ssl_verify, database_ssl_verify

  config :backend, Backend.Repo,
    ssl: true,
    ssl_opts: ssl_opts,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    socket_options: maybe_ipv6

  # The secret key base is used to sign/encrypt cookies and other secrets.
  # A default value is used in config/dev.exs and config/test.exs but you
  # want to use a different value for prod and you most likely don't want
  # to check this value into version control, so we use an environment
  # variable instead.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"

  config :backend, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  # The frontend is deployed on a separate origin (e.g. Vercel) from this
  # backend (e.g. Render/Railway), unlike in dev where a proxy makes them
  # look same-origin. Both the CORS plug (for /api fetches) and Phoenix's
  # own WebSocket origin check need to know that origin explicitly, or
  # they'll reject the frontend's requests. Accepts a comma-separated list
  # (e.g. a production domain plus Vercel preview URLs).
  frontend_origins =
    case System.get_env("FRONTEND_URL") do
      nil -> nil
      value -> value |> String.split(",") |> Enum.map(&String.trim/1)
    end

  config :backend, :cors_origins, frontend_origins || "*"

  # check_origin must not silently fall back to `false` (which disables
  # Phoenix's WebSocket origin check entirely) just because FRONTEND_URL
  # was left unset by mistake — fail loudly at boot instead.
  check_origin =
    frontend_origins ||
      raise """
      FRONTEND_URL ortam değişkeni prod ortamında zorunludur, WebSocket origin kontrolü için gereklidir.
      Örnek: FRONTEND_URL=https://example.com veya FRONTEND_URL=https://example.com,https://preview.vercel.app
      """

  # Blocks requests that skipped Cloudflare entirely (see
  # BackendWeb.RequireCloudflarePlug) — set this to the same random value
  # configured in a Cloudflare Transform Rule that adds it as the
  # X-Origin-Secret header on every request Cloudflare forwards to this
  # origin. Left unset, the plug no-ops (no protection) — only actually
  # closes the bypass once both sides agree on a value.
  config :backend, :cloudflare_origin_secret, System.get_env("CLOUDFLARE_ORIGIN_SECRET")

  # Sentry.LoggerHandler (attached in Backend.Application, registered in
  # config/config.exs) reports unhandled exceptions and process crashes
  # here. Left unset, Sentry itself no-ops — nothing is ever sent.
  config :sentry,
    dsn: System.get_env("SENTRY_DSN"),
    environment_name: config_env(),
    enable_source_code_context: true,
    root_source_code_paths: [File.cwd!()]

  # Structured JSON logs — prod only, deliberately not dev/test (see
  # config.exs's :default_formatter/dev.exs, both untouched, still the
  # human-readable text format there; JSON is unpleasant to read in a dev
  # terminal). Existing Logger.info/warning/error call sites (rate
  # limiting, RequireCloudflarePlug, the voice ICE diagnostics, ...) don't
  # need any changes — LoggerJSON.Formatters.Basic reformats whatever they
  # already log, same message text, just as a JSON object's "message"
  # field instead of interpolated into a plain-text line. `metadata: :all`
  # (not just [:request_id], config.exs's default) so a Render/Railway log
  # viewer's JSON search/filter (e.g. by request_id, module, or any other
  # metadata a call site attaches) actually has something to search across
  # — the whole point of switching to JSON in the first place.
  config :logger, :default_handler, formatter: {LoggerJSON.Formatters.Basic, metadata: :all}

  # Chat attachment storage. Local disk (the dev default, see config.exs)
  # doesn't survive across instances/redeploys on most PaaS providers, so
  # production should point at an S3-compatible bucket instead — AWS S3,
  # Cloudflare R2, or DigitalOcean Spaces all work via Backend.Uploads.S3's
  # SigV4 signer without any adapter-specific code. Falls back to :local if
  # S3_BUCKET isn't set, so an S3-less deploy still boots (uploads just
  # won't survive a redeploy/multi-instance setup — same limitation as
  # before this config existed).
  #
  # R2 example:
  #   S3_BUCKET=zircle-uploads
  #   S3_REGION=auto
  #   S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
  #   S3_ACCESS_KEY_ID=...
  #   S3_SECRET_ACCESS_KEY=...
  #   S3_PUBLIC_URL_BASE=https://pub-xxxxxxxx.r2.dev
  #
  # Plain AWS S3 example: omit S3_ENDPOINT/S3_PUBLIC_URL_BASE, set
  # S3_REGION to the bucket's real region (e.g. eu-central-1) and make the
  # bucket (or its objects) publicly readable, or front it with a CDN and
  # set S3_PUBLIC_URL_BASE to that instead.
  if System.get_env("S3_BUCKET") do
    config :backend, :uploads,
      adapter: :s3,
      bucket: System.fetch_env!("S3_BUCKET"),
      region: System.get_env("S3_REGION", "auto"),
      endpoint: System.get_env("S3_ENDPOINT"),
      access_key_id: System.fetch_env!("S3_ACCESS_KEY_ID"),
      secret_access_key: System.fetch_env!("S3_SECRET_ACCESS_KEY"),
      public_url_base: System.get_env("S3_PUBLIC_URL_BASE")
  end

  config :backend, BackendWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [
      # Enable IPv6 and bind on all interfaces.
      # Set it to  {0, 0, 0, 0, 0, 0, 0, 1} for local network only access.
      # See the documentation on https://bandit.hexdocs.pm/Bandit.html#t:options/0
      # for details about using IPv6 vs IPv4 and loopback vs public addresses.
      ip: {0, 0, 0, 0, 0, 0, 0, 0}
    ],
    check_origin: check_origin,
    secret_key_base: secret_key_base

  # ## SSL Support
  #
  # To get SSL working, you will need to add the `https` key
  # to your endpoint configuration:
  #
  #     config :backend, BackendWeb.Endpoint,
  #       https: [
  #         ...,
  #         port: 443,
  #         cipher_suite: :strong,
  #         keyfile: System.get_env("SOME_APP_SSL_KEY_PATH"),
  #         certfile: System.get_env("SOME_APP_SSL_CERT_PATH")
  #       ]
  #
  # The `cipher_suite` is set to `:strong` to support only the
  # latest and more secure SSL ciphers. This means old browsers
  # and clients may not be supported. You can set it to
  # `:compatible` for wider support.
  #
  # `:keyfile` and `:certfile` expect an absolute path to the key
  # and cert in disk or a relative path inside priv, for example
  # "priv/ssl/server.key". For all supported SSL configuration
  # options, see https://plug.hexdocs.pm/Plug.SSL.html#configure/1
  #
  # We also recommend setting `force_ssl` in your config/prod.exs,
  # ensuring no data is ever sent via http, always redirecting to https:
  #
  #     config :backend, BackendWeb.Endpoint,
  #       force_ssl: [hsts: true]
  #
  # Check `Plug.SSL` for all available options in `force_ssl`.

  # ## Configuring the mailer
  #
  # In production you need to configure the mailer to use a different adapter.
  # Here is an example configuration for Mailgun:
  #
  #     config :backend, Backend.Mailer,
  #       adapter: Swoosh.Adapters.Mailgun,
  #       api_key: System.get_env("MAILGUN_API_KEY"),
  #       domain: System.get_env("MAILGUN_DOMAIN")
  #
  # Most non-SMTP adapters require an API client. Swoosh supports Req, Hackney,
  # and Finch out-of-the-box. This configuration is typically done at
  # compile-time in your config/prod.exs:
  #
  #     config :swoosh, :api_client, Swoosh.ApiClient.Req
  #
  # See https://swoosh.hexdocs.pm/Swoosh.html#module-installation for details.
end
