defmodule Backend.PushBrowser do
  @moduledoc """
  Plays the browser's side of Web Push in tests: makes the subscription
  keys a browser would (`new/1`), and decrypts what the server sent
  (`decrypt/2`) the way the browser would — RFC 8291, independently of the
  sending code except for the key derivation it checks against.
  """

  alias Backend.Push.WebPush

  @doc "A browser's subscription: keys plus the JSON its PushSubscription gives."
  def new(host \\ "fcm.googleapis.com") do
    {public, private} = :crypto.generate_key(:ecdh, :prime256v1)
    auth = :crypto.strong_rand_bytes(16)
    endpoint = "https://#{host}/fcm/send/#{System.unique_integer([:positive])}"

    %{
      public: public,
      private: private,
      auth: auth,
      endpoint: endpoint,
      attrs: %{
        "endpoint" => endpoint,
        "p256dh" => Base.url_encode64(public, padding: false),
        "auth" => Base.url_encode64(auth, padding: false)
      }
    }
  end

  @doc "The plaintext of an `aes128gcm` body sent to `browser`."
  def decrypt(body, browser) do
    <<salt::binary-size(16), _rs::unsigned-big-32, key_length::8, rest::binary>> = body
    <<as_public::binary-size(^key_length), sealed::binary>> = rest
    ciphertext = binary_part(sealed, 0, byte_size(sealed) - 16)
    tag = binary_part(sealed, byte_size(sealed) - 16, 16)

    shared = :crypto.compute_key(:ecdh, as_public, browser.private, :prime256v1)
    {cek, nonce} = WebPush.content_keys(shared, browser.auth, salt, browser.public, as_public)

    case :crypto.crypto_one_time_aead(:aes_128_gcm, cek, nonce, ciphertext, <<>>, tag, false) do
      :error ->
        :error

      padded ->
        # Strip any padding, then the last-record delimiter (0x02).
        unpadded = String.trim_trailing(padded, <<0>>)
        <<2>> = binary_part(unpadded, byte_size(unpadded) - 1, 1)
        binary_part(unpadded, 0, byte_size(unpadded) - 1)
    end
  end
end
