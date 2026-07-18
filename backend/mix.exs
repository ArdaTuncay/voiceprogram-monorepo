defmodule Backend.MixProject do
  use Mix.Project

  def project do
    [
      app: :backend,
      version: "0.1.0",
      elixir: "~> 1.15",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      listeners: [Phoenix.CodeReloader]
    ]
  end

  # Configuration for the OTP application.
  #
  # Type `mix help compile.app` for more information.
  def application do
    [
      mod: {Backend.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  def cli do
    [
      preferred_envs: [precommit: :test]
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Specifies your project dependencies.
  #
  # Type `mix help deps` for examples and options.
  defp deps do
    [
      {:phoenix, "~> 1.8.8"},
      {:phoenix_ecto, "~> 4.5"},
      {:ecto_sql, "~> 3.13"},
      {:postgrex, ">= 0.0.0"},
      {:phoenix_live_dashboard, "~> 0.8.3"},
      {:swoosh, "~> 1.16"},
      {:req, "~> 0.5"},
      {:telemetry_metrics, "~> 1.0"},
      {:telemetry_poller, "~> 1.0"},
      {:gettext, "~> 1.0"},
      {:jason, "~> 1.2"},
      {:dns_cluster, "~> 0.2.0"},
      {:bandit, "~> 1.5"},
      {:pbkdf2_elixir, "~> 2.0"},
      {:cors_plug, "~> 3.0"},
      {:hammer, "~> 7.0"},
      {:remote_ip, "~> 1.2"},
      {:sentry, "~> 13.2"},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev], runtime: false},
      {:mix_audit, "~> 2.1", only: [:dev, :test], runtime: false}
    ]
  end

  # Aliases are shortcuts or tasks specific to the current project.
  # For example, to install project dependencies and perform other setup tasks, run:
  #
  #     $ mix setup
  #
  # See the documentation for `Mix` for more info on aliases.
  defp aliases do
    [
      setup: ["deps.get", "ecto.setup"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"],
      precommit: [
        "compile --warnings-as-errors",
        "credo --strict",
        "deps.audit",
        &hex_audit!/1,
        "deps.unlock --unused",
        "format",
        &dialyzer!/1,
        "test"
      ]
    ]
  end

  # `mix hex.audit` doesn't compose with a Mix alias two ways: (1) it's
  # provided by the Hex archive, not a project dep, and after `compile`/
  # `deps.audit` run earlier in this same alias, dependency compilation
  # prunes code paths out from under it — `Code.ensure_loaded(Mix.Tasks.Hex.Audit)`
  # comes back `{:error, :nofile}` and the alias fails with "task could not
  # be found". (2) On finding an advisory, Hex doesn't halt inline — it
  # calls `System.at_exit(fn _ -> System.halt(1) end)` (see hex's own
  # lib/mix/tasks/hex.ex), which only fires once the whole `mix precommit`
  # VM is about to exit *anyway*, so `deps.unlock`/`format`/`test` would all
  # run to completion first before the failure ever surfaced — the opposite
  # of the fail-fast gate this alias is for. Running it as its own `mix`
  # subprocess sidesteps both: a fresh process loads the Hex archive
  # cleanly, and its exit code is checked and raised on here, immediately,
  # instead of waiting for Hex's own deferred halt.
  defp hex_audit!(_) do
    {output, status} =
      System.cmd("mix", ["hex.audit"],
        stderr_to_stdout: true,
        env: [{"MIX_ENV", to_string(Mix.env())}]
      )

    IO.puts(output)

    if status != 0 do
      Mix.raise("mix hex.audit found retired or vulnerable dependencies (see output above)")
    end
  end

  # Same reasoning as `hex_audit!/1` above, different root cause: `dialyxir`
  # is `only: [:dev]` (its PLT/analysis is a dev-workflow tool, and staying
  # dev-only avoids paying its compile cost in `:test`), but `precommit`
  # itself runs under `:test` (`preferred_envs: [precommit: :test]`), where
  # the `dialyzer` task simply isn't loaded — running it as a plain alias
  # string fails with "task could not be found", the same failure mode
  # `hex_audit!/1` works around for `mix hex.audit`.
  #
  # Beyond availability, `:test`'s `elixirc_paths` also includes
  # `test/support` (needed for `ConnCase`/`DataCase` during `mix test`) —
  # analyzing those under dialyzer surfaces spurious `unknown_function`
  # errors for macro-generated internals like `ExUnit.Callbacks.__noop__/0`
  # that don't exist when only `lib/` is analyzed. A `MIX_ENV=dev`
  # subprocess sidesteps both problems at once: a fresh `:dev` process has
  # `dialyzer` loaded and only ever analyzes `lib/`, matching the clean,
  # 0-warning baseline this project actually has today.
  defp dialyzer!(_) do
    {output, status} =
      System.cmd("mix", ["dialyzer"], stderr_to_stdout: true, env: [{"MIX_ENV", "dev"}])

    IO.puts(output)

    if status != 0 do
      Mix.raise("mix dialyzer found issues (see output above)")
    end
  end
end
