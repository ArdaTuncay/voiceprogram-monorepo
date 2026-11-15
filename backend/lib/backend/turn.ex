defmodule Backend.Turn do
  @lifetime_seconds 48 * 60 * 60
  @refresh_below_seconds div(@lifetime_seconds, 2)
  @min_usable_seconds 60 * 60
  @expiry_margin_seconds 60

  @moduledoc """
  Builds the ICE server list a user's browser gets from
  `GET /api/voice/turn-credentials` (`BackendWeb.VoiceController`). Three
  modes, picked by config, best first:

    1. **Per-user Metered credentials** — `config :backend, :metered_api`
       (`METERED_APP_NAME` + `METERED_SECRET_KEY`). Each user gets their own
       credential from Metered's REST API (`Backend.Turn.Metered`), labelled
       with their user id, valid for #{div(@lifetime_seconds, 3600)} hours,
       stored in `turn_credentials` (`Backend.Turn.Credential`).
    2. **One static credential** — `:turn_config` (`METERED_TURN_USERNAME` +
       `METERED_TURN_CREDENTIAL`). The previous behavior, kept only so a
       deploy doesn't break voice before the new env vars are set: every
       user receives the same long-lived password. Logs a warning.
    3. **STUN only** — nothing configured.

  Why per-user: a credential handed to every browser can be copied out and
  used as a free relay, billed to this account, for as long as it lives —
  with one static credential, that's forever, even after the account that
  copied it is deleted. A per-user credential stops working within
  #{div(@lifetime_seconds, 3600)} h, its traffic is attributable (Metered
  usage per label) and it can be disabled on its own.

  Rotation has to respect two Metered behaviors: a new credential can take
  up to 2 minutes before it relays anything, and an expired one stops
  working immediately, mid-call included. So:

    * more than half its lifetime left — handed out as is;
    * less than that, but at least an hour — still handed out, while a
      replacement is created in the background (it propagates long before
      the old one runs out);
    * missing, expired or nearly so — created on the spot. It may need up
      to 2 minutes to work, so any still-valid old entries go along with it.
      `prewarm/1`, called when a user's socket connects, makes this rare.

  A Metered API failure falls back to mode 2 if still configured, else STUN
  only — a TURN outage never stops anyone from joining voice.
  """

  require Logger

  alias Backend.Repo
  alias Backend.Turn.{Credential, Metered}

  @stun_url "stun:stun.relay.metered.ca:80"
  @static_turn_urls [
    "turn:global.relay.metered.ca:80",
    "turn:global.relay.metered.ca:80?transport=tcp",
    "turn:global.relay.metered.ca:443",
    "turns:global.relay.metered.ca:443?transport=tcp"
  ]

  @doc """
  Returns `{:ok, ice_servers}` for `user_id` — always `{:ok, _}`, with at
  least Metered's STUN entry.
  """
  @spec fetch_ice_servers(Ecto.UUID.t()) :: {:ok, [map()]}
  def fetch_ice_servers(user_id) do
    servers = if Metered.configured?(), do: per_user_servers(user_id), else: static_servers()
    {:ok, [%{urls: @stun_url} | servers]}
  end

  @doc """
  Makes sure `user_id` has a usable credential before they need one — a
  brand-new credential takes up to 2 minutes to work, so creating it when
  the user's socket connects rather than when they click a voice channel
  usually hides that delay. Runs in the background; a no-op unless
  per-user credentials are configured.
  """
  @spec prewarm(Ecto.UUID.t()) :: :ok
  def prewarm(user_id) do
    if Metered.configured?(), do: refresh_in_background(user_id)
    :ok
  end

  defp per_user_servers(user_id) do
    credential = Repo.get_by(Credential, user_id: user_id)

    case freshness(credential) do
      :fresh ->
        credential.ice_servers

      :aging ->
        refresh_in_background(user_id)
        credential.ice_servers

      :expiring ->
        issue_now(user_id, credential.ice_servers)

      :missing ->
        issue_now(user_id, [])
    end
  end

  defp freshness(nil), do: :missing

  defp freshness(%Credential{expires_at: expires_at}) do
    left = DateTime.diff(expires_at, DateTime.utc_now())

    cond do
      left > @refresh_below_seconds -> :fresh
      left > @min_usable_seconds -> :aging
      left > 0 -> :expiring
      true -> :missing
    end
  end

  defp issue_now(user_id, still_valid) do
    case issue(user_id) do
      {:ok, credential} ->
        credential.ice_servers ++ still_valid

      {:error, reason} ->
        log_issue_failure(user_id, reason)
        if still_valid == [], do: static_servers(), else: still_valid
    end
  end

  defp issue(user_id) do
    with {:ok, issued} <- Metered.create_credential(user_id, @lifetime_seconds) do
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      %Credential{
        user_id: user_id,
        metered_username: issued.username,
        ice_servers: issued.ice_servers,
        # Metered's clock started before ours did; err on the early side.
        expires_at: DateTime.add(now, issued.expires_in - @expiry_margin_seconds, :second)
      }
      |> Repo.insert(
        on_conflict: {:replace, [:metered_username, :ice_servers, :expires_at, :updated_at]},
        conflict_target: :user_id,
        returning: true
      )
    end
  end

  defp refresh_in_background(user_id) do
    run(fn ->
      # Zero retries: if a refresh for this user is already running
      # (another request, another node), skip instead of creating a
      # second credential for nothing.
      :global.trans(
        {{__MODULE__, :refresh}, user_id},
        fn -> refresh(user_id) end,
        [node() | Node.list()],
        0
      )
    end)
  end

  # Re-checked inside the lock: another refresh may have just finished.
  defp refresh(user_id) do
    credential = Repo.get_by(Credential, user_id: user_id)

    if freshness(credential) != :fresh do
      case issue(user_id) do
        {:ok, _credential} -> :ok
        {:error, reason} -> log_issue_failure(user_id, reason)
      end
    end
  end

  # config/test.exs sets `refresh: :inline` so tests can observe the result
  # deterministically (and inside their own DB sandbox).
  defp run(fun) do
    case Application.get_env(:backend, __MODULE__, [])[:refresh] do
      :inline -> fun.()
      _ -> Task.Supervisor.start_child(Backend.TaskSupervisor, fun)
    end

    :ok
  end

  defp log_issue_failure(user_id, reason) do
    Logger.error(
      "Metered TURN kimlik bilgisi oluşturulamadı user_id=#{user_id} reason=#{inspect(reason)}"
    )
  end

  defp static_servers do
    case Application.get_env(:backend, :turn_config) do
      %{username: username, credential: credential}
      when is_binary(username) and username != "" and is_binary(credential) and
             credential != "" ->
        Logger.warning(
          "TURN: tek bir statik parola tüm kullanıcılara veriliyor; " <>
            "METERED_APP_NAME/METERED_SECRET_KEY ile kullanıcı başına parolaya geçin"
        )

        Enum.map(@static_turn_urls, &%{urls: &1, username: username, credential: credential})

      _ ->
        Logger.warning(
          "Metered TURN yapılandırılmamış (:turn_config set değil), sadece STUN kullanılacak"
        )

        []
    end
  end
end
