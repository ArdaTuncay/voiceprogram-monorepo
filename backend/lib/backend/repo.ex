defmodule Backend.Repo do
  use Ecto.Repo,
    otp_app: :backend,
    adapter: Ecto.Adapters.Postgres

  # Some managed Postgres providers (confirmed on Render — see
  # PROJECT_ARCHITECTURE.md 3.5) present a wildcard SAN cert (e.g.
  # `*.frankfurt-postgres.render.com`) for their connection hostname.
  # Erlang's default TLS hostname check rejects that pairing; :public_key's
  # HTTPS-profile match function accepts it (RFC 6125 wildcard rules) — see
  # `:public_key.pkix_verify_hostname_match_fun/1`.
  #
  # This can't be set directly in config/runtime.exs's ssl_opts: that file
  # is evaluated by Config.Provider, which persists the resulting config to
  # a text file at boot and explicitly cannot serialize function values
  # (see Config.Provider's own moduledoc, and elixir/lib/elixir/lib/config/
  # provider.ex's write_config!/2, which formats the config with
  # `:io_lib.format("~tw", ...)` — a fun there produces unparseable text,
  # which then fails to be read back with `:file.consult` on the very next
  # boot). Ecto.Repo's `init/2` callback runs later, as plain application
  # code after that boot-time serialization step, so a function value here
  # is safe.
  @impl Ecto.Repo
  def init(_context, config) do
    {:ok, maybe_add_https_hostname_check(config)}
  end

  defp maybe_add_https_hostname_check(config) do
    ssl_opts = Keyword.get(config, :ssl_opts)

    if ssl_opts && Keyword.get(ssl_opts, :verify) == :verify_peer do
      updated_ssl_opts =
        Keyword.put(ssl_opts, :customize_hostname_check,
          match_fun: :public_key.pkix_verify_hostname_match_fun(:https)
        )

      Keyword.put(config, :ssl_opts, updated_ssl_opts)
    else
      config
    end
  end
end
