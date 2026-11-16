defmodule Backend.Push.WebPush do
  @moduledoc """
  The Web Push protocol, by hand on `:crypto` (as `Backend.Uploads.S3` does
  SigV4), since it's small and a dependency would be most of the code:

    * the message is encrypted for the browser — RFC 8291 (ECDH on P-256
      with the subscription's `p256dh` key, HKDF with its `auth` secret,
      AES-128-GCM, the `aes128gcm` content coding of RFC 8188) — so the
      push service only ever sees ciphertext;
    * the request carries a VAPID signature — RFC 8292, an ES256 JWT for the
      push service's origin — proving it comes from the holder of the key
      the browser subscribed with.
  """

  @record_size 4096
  @jwt_ttl 12 * 60 * 60

  @doc """
  The `aes128gcm` request body for `plaintext`, encrypted for the browser
  whose subscription keys are `ua_public` (65 bytes, uncompressed P-256
  point) and `auth_secret` (16 bytes). `opts` can fix the ephemeral
  `:keys` and the `:salt` (tests); both are random otherwise.
  """
  @spec encrypt(binary(), binary(), binary(), keyword()) :: binary()
  def encrypt(plaintext, ua_public, auth_secret, opts \\ []) do
    {as_public, as_private} = Keyword.get_lazy(opts, :keys, &new_keypair/0)
    salt = Keyword.get_lazy(opts, :salt, fn -> :crypto.strong_rand_bytes(16) end)

    shared_secret = :crypto.compute_key(:ecdh, ua_public, as_private, :prime256v1)
    {cek, nonce} = content_keys(shared_secret, auth_secret, salt, ua_public, as_public)

    # One record, so it ends with the last-record delimiter 0x02.
    {ciphertext, tag} =
      :crypto.crypto_one_time_aead(:aes_128_gcm, cek, nonce, plaintext <> <<2>>, <<>>, true)

    salt <>
      <<@record_size::unsigned-big-32, byte_size(as_public)::8>> <>
      as_public <> ciphertext <> tag
  end

  @doc """
  The CEK and nonce for one message (RFC 8291 §3.4, RFC 8188 §2.2). Public
  so the tests can decrypt what `encrypt/4` produced.
  """
  @spec content_keys(binary(), binary(), binary(), binary(), binary()) :: {binary(), binary()}
  def content_keys(shared_secret, auth_secret, salt, ua_public, as_public) do
    prk_key = hmac(auth_secret, shared_secret)
    ikm = hmac(prk_key, "WebPush: info" <> <<0>> <> ua_public <> as_public <> <<1>>)
    prk = hmac(salt, ikm)
    <<cek::binary-size(16), _::binary>> = hmac(prk, "Content-Encoding: aes128gcm" <> <<0, 1>>)
    <<nonce::binary-size(12), _::binary>> = hmac(prk, "Content-Encoding: nonce" <> <<0, 1>>)
    {cek, nonce}
  end

  @doc """
  The `Authorization` header for a push to `endpoint`: `vapid t=<JWT>,
  k=<public key>`. Keys are unpadded base64url, as `mix push.gen.vapid`
  prints them.
  """
  @spec authorization(String.t(), String.t(), String.t(), String.t(), integer()) :: String.t()
  def authorization(
        endpoint,
        public_key,
        private_key,
        subject,
        now \\ System.system_time(:second)
      ) do
    %URI{scheme: scheme, host: host} = URI.parse(endpoint)
    header = encode_json(%{typ: "JWT", alg: "ES256"})
    claims = encode_json(%{aud: "#{scheme}://#{host}", exp: now + @jwt_ttl, sub: subject})
    signing_input = header <> "." <> claims

    der =
      :crypto.sign(:ecdsa, :sha256, signing_input, [
        Base.url_decode64!(private_key, padding: false),
        :prime256v1
      ])

    # JWS wants the raw 64-byte r || s, not the DER encoding :crypto gives.
    {:"ECDSA-Sig-Value", r, s} = :public_key.der_decode(:"ECDSA-Sig-Value", der)
    signature = Base.url_encode64(<<r::unsigned-big-256, s::unsigned-big-256>>, padding: false)

    "vapid t=#{signing_input}.#{signature}, k=#{public_key}"
  end

  @doc "A new P-256 key pair, `{public, private}` as raw binaries."
  def new_keypair, do: :crypto.generate_key(:ecdh, :prime256v1)

  defp encode_json(map), do: map |> Jason.encode!() |> Base.url_encode64(padding: false)

  defp hmac(key, data), do: :crypto.mac(:hmac, :sha256, key, data)
end
