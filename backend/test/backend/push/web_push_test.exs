defmodule Backend.Push.WebPushTest do
  use ExUnit.Case, async: true

  alias Backend.Push.WebPush
  alias Backend.PushBrowser

  defp d(value), do: Base.url_decode64!(value, padding: false)

  describe "encrypt/4" do
    # RFC 8291 §5 (and its Appendix A): fixed keys and salt, known output.
    test "matches the RFC 8291 example byte for byte" do
      as_public =
        d(
          "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
        )

      as_private = d("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")

      ua_public =
        d(
          "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
        )

      body =
        WebPush.encrypt(
          "When I grow up, I want to be a watermelon",
          ua_public,
          d("BTBZMqHH6r4Tts7J_aSIgg"),
          keys: {as_public, as_private},
          salt: d("DGv6ra1nlYgDCS1FRnbzlw")
        )

      assert Base.url_encode64(body, padding: false) ==
               "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    end

    test "is readable by the browser it was encrypted for, and only by it" do
      browser = PushBrowser.new()
      body = WebPush.encrypt(~s({"title":"ard"}), browser.public, browser.auth)

      assert PushBrowser.decrypt(body, browser) == ~s({"title":"ard"})
      assert PushBrowser.decrypt(body, PushBrowser.new()) == :error
    end
  end

  describe "authorization/5" do
    test "is a VAPID header: an ES256 JWT for the push service's origin, plus the public key" do
      {public, private} = WebPush.new_keypair()
      public_b64 = Base.url_encode64(public, padding: false)

      header =
        WebPush.authorization(
          "https://fcm.googleapis.com/fcm/send/abc",
          public_b64,
          Base.url_encode64(private, padding: false),
          "mailto:ops@zircle.test",
          1_000
        )

      assert ["vapid t=" <> jwt, "k=" <> ^public_b64] = String.split(header, ", ")
      [h, c, signature] = String.split(jwt, ".")

      assert %{"alg" => "ES256", "typ" => "JWT"} = Jason.decode!(d(h))

      assert Jason.decode!(d(c)) == %{
               "aud" => "https://fcm.googleapis.com",
               "exp" => 1_000 + 12 * 60 * 60,
               "sub" => "mailto:ops@zircle.test"
             }

      <<r::unsigned-big-256, s::unsigned-big-256>> = d(signature)
      der = :public_key.der_encode(:"ECDSA-Sig-Value", {:"ECDSA-Sig-Value", r, s})
      assert :crypto.verify(:ecdsa, :sha256, h <> "." <> c, der, [public, :prime256v1])
    end
  end
end
