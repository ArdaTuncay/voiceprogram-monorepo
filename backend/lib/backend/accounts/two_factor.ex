defmodule Backend.Accounts.TwoFactor do
  @moduledoc """
  Two-factor sign-in with time-based one-time codes (TOTP, RFC 6238 — 6
  digits every 30 seconds, as Google Authenticator, Authy, 1Password and
  the like produce).

    * Turning it on: `setup/1` makes a secret and hands it out (as a QR code
      and as text) inside an encrypted, 15-minute setup token; nothing is
      stored until `enable/3` gets a code from it — proof the authenticator
      app has the secret. Then ten single-use recovery codes are issued,
      shown once.
    * Signing in: a correct password gets a 5-minute `challenge/1` instead
      of a session; `verify_challenge/2` takes a current code or a recovery
      code and returns the user to open the session for.

  Safeguards:

    * the secret is stored encrypted with a key derived from the
      endpoint's `secret_key_base` — rotating that key turns two-factor
      off for everyone (they'd have to set it up again), so don't;
    * recovery codes are stored only as SHA-256 hashes (they're 50 random
      bits each, so a fast hash is enough) and removed when used;
    * a code is accepted for its own 30-second step or one step either
      side (phone clocks drift), but never twice: the step of the last
      code used is recorded, and both that and taking a recovery code are
      single conditional updates, so two requests racing with the same
      code can't both win;
    * 10 attempts per account per 15 minutes, on top of the per-IP
      limit on the endpoint — six digits are only a million guesses;
    * a challenge is tied to the account's `token_version`, so changing
      the password voids the ones already handed out.
  """

  import Ecto.Query

  alias Backend.Accounts.User
  alias Backend.{RateLimiter, Repo}

  @issuer "Zircle"
  @step 30
  @setup_salt "two factor setup"
  @setup_max_age 15 * 60
  @challenge_salt "two factor challenge"
  @challenge_max_age 5 * 60
  @secret_salt "two factor secret v1"
  @recovery_count 10
  @attempt_window :timer.minutes(15)
  @attempt_limit 10

  @doc "Whether `user` has two-factor sign-in turned on."
  def enabled?(%User{totp_enabled_at: enabled_at}), do: not is_nil(enabled_at)

  @doc "What the settings page shows."
  def status(%User{} = user) do
    %{enabled: enabled?(user), recovery_codes_left: length(user.totp_recovery_hashes || [])}
  end

  @doc """
  A new secret for `user`: as base32 text (to type in), an `otpauth://`
  link, a QR code of it (an SVG data URI) and the setup token `enable/3`
  needs back. Changes nothing yet.
  """
  def setup(%User{} = user) do
    secret = NimbleTOTP.secret()
    uri = NimbleTOTP.otpauth_uri("#{@issuer}:#{user.email}", secret, issuer: @issuer)
    svg = uri |> EQRCode.encode() |> EQRCode.svg(width: 240)

    %{
      secret: Base.encode32(secret, padding: false),
      otpauth_uri: uri,
      qr_data_uri: "data:image/svg+xml;base64," <> Base.encode64(svg),
      setup_token: Phoenix.Token.encrypt(BackendWeb.Endpoint, @setup_salt, {user.id, secret})
    }
  end

  @doc """
  Turns two-factor on once `code` checks out against the secret in
  `setup_token`. Returns `{:ok, recovery_codes}` (plain text, shown once),
  `{:error, :invalid_setup}` (expired, forged or someone else's) or
  `{:error, :invalid_code}`.
  """
  def enable(%User{id: user_id} = user, setup_token, code) do
    with {:ok, {^user_id, secret}} <-
           Phoenix.Token.decrypt(BackendWeb.Endpoint, @setup_salt, to_string(setup_token),
             max_age: @setup_max_age
           ),
         {:ok, step_start} <- match_code(secret, code, nil) do
      codes = new_recovery_codes()

      user
      |> Ecto.Changeset.change(
        totp_secret: encrypt(secret),
        totp_enabled_at: DateTime.utc_now(:second),
        totp_last_used_at: step_start,
        totp_recovery_hashes: Enum.map(codes, &hash/1)
      )
      |> Repo.update!()

      {:ok, codes}
    else
      :error -> {:error, :invalid_code}
      _ -> {:error, :invalid_setup}
    end
  end

  @doc """
  Turns two-factor off, given a current code or a recovery code (the
  controller has already checked the password). `{:error, :invalid_code}`
  otherwise.
  """
  def disable(%User{} = user, code) do
    with true <- enabled?(user),
         :ok <- consume(user, code) do
      user
      |> Ecto.Changeset.change(
        totp_secret: nil,
        totp_enabled_at: nil,
        totp_last_used_at: nil,
        totp_recovery_hashes: []
      )
      |> Repo.update!()

      :ok
    else
      _ -> {:error, :invalid_code}
    end
  end

  @doc "A 5-minute token standing for \"`user` got their password right\"."
  def challenge(%User{} = user) do
    Phoenix.Token.sign(BackendWeb.Endpoint, @challenge_salt, %{
      user_id: user.id,
      v: user.token_version
    })
  end

  @doc """
  Completes a sign-in: `{:ok, user}` when `challenge` is valid and `code`
  is a current code or an unused recovery code; otherwise
  `{:error, :invalid_challenge | :invalid_code | :too_many_attempts}`.
  """
  def verify_challenge(challenge, code) do
    with {:ok, %{user_id: user_id, v: version}} <-
           Phoenix.Token.verify(BackendWeb.Endpoint, @challenge_salt, to_string(challenge),
             max_age: @challenge_max_age
           ),
         %User{} = user <- Repo.get(User, user_id),
         true <- user.token_version == version and enabled?(user),
         :ok <- count_attempt(user) do
      if consume(user, code) == :ok, do: {:ok, user}, else: {:error, :invalid_code}
    else
      {:error, :too_many_attempts} = error -> error
      _ -> {:error, :invalid_challenge}
    end
  end

  defp count_attempt(%User{id: id}) do
    case RateLimiter.hit({:two_factor, id}, @attempt_window, @attempt_limit) do
      {:allow, _count} -> :ok
      {:deny, _retry_after} -> {:error, :too_many_attempts}
    end
  end

  # A six-digit code goes through TOTP; anything else is tried as a
  # recovery code. Either way it's used up on success.
  defp consume(%User{} = user, code) do
    code = code |> to_string() |> String.replace(~r/\s/, "")

    if code =~ ~r/\A\d{6}\z/,
      do: consume_totp(user, code),
      else: consume_recovery_code(user, code)
  end

  defp consume_totp(%User{id: id, totp_last_used_at: last_used} = user, code) do
    with {:ok, secret} <- decrypt(user.totp_secret),
         {:ok, step_start} <- match_code(secret, code, last_used),
         {1, _} <-
           Repo.update_all(
             from(u in User,
               where:
                 u.id == ^id and
                   (is_nil(u.totp_last_used_at) or u.totp_last_used_at < ^step_start)
             ),
             set: [totp_last_used_at: step_start]
           ) do
      :ok
    else
      _ -> :error
    end
  end

  defp consume_recovery_code(%User{id: id}, code) do
    hashed = code |> normalize_recovery() |> hash()

    query =
      from u in User,
        where: u.id == ^id and fragment("? = ANY(?)", ^hashed, u.totp_recovery_hashes),
        update: [
          set: [
            totp_recovery_hashes: fragment("array_remove(?, ?)", u.totp_recovery_hashes, ^hashed)
          ]
        ]

    case Repo.update_all(query, []) do
      {1, _} -> :ok
      _ -> :error
    end
  end

  # The start of the step `code` belongs to — its own, or one either side
  # — provided that's later than the step of the last code used.
  defp match_code(secret, code, last_used) when is_binary(code) do
    now = System.os_time(:second)

    Enum.find_value([0, -1, 1], :error, fn offset ->
      time = now + offset * @step
      step_start = DateTime.from_unix!(time - rem(time, @step))

      if fresh?(step_start, last_used) and NimbleTOTP.valid?(secret, code, time: time),
        do: {:ok, step_start}
    end)
  end

  defp match_code(_secret, _code, _last_used), do: :error

  defp fresh?(_step_start, nil), do: true
  defp fresh?(step_start, last_used), do: DateTime.compare(step_start, last_used) == :gt

  # "abcde-fghij": 50 random bits, base32 (no 0/1/8/9 to confuse), grouped.
  defp new_recovery_codes do
    for _ <- 1..@recovery_count do
      <<a::binary-size(5), b::binary-size(5), _::binary>> =
        :crypto.strong_rand_bytes(8) |> Base.encode32(padding: false) |> String.downcase()

      a <> "-" <> b
    end
  end

  defp normalize_recovery(code), do: code |> String.downcase() |> String.replace("-", "")

  defp hash(code),
    do: :sha256 |> :crypto.hash(normalize_recovery(code)) |> Base.encode16(case: :lower)

  defp encrypt(secret), do: Plug.Crypto.encrypt(secret_key_base(), @secret_salt, secret)

  defp decrypt(nil), do: :error

  defp decrypt(stored) do
    case Plug.Crypto.decrypt(secret_key_base(), @secret_salt, stored, max_age: :infinity) do
      {:ok, secret} -> {:ok, secret}
      _ -> :error
    end
  end

  defp secret_key_base, do: BackendWeb.Endpoint.config(:secret_key_base)
end
