defmodule Backend.Push.Subscription do
  @moduledoc """
  A browser's push subscription (the `PushSubscription` the Push API hands
  out): where to send (`endpoint`, on the browser vendor's push service) and
  the keys to encrypt for (`p256dh`, `auth`). See `Backend.Push`.

  Only the big browsers' push services are accepted as endpoints: the server
  POSTs to whatever is stored here, so an arbitrary URL would let anyone make
  it send requests wherever they liked.
  """
  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.{Session, User}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  # Chrome, Edge, Firefox, Safari (and every Chromium-based browser, which
  # use Google's service).
  @push_hosts ~w(fcm.googleapis.com android.googleapis.com)
  @push_host_suffixes ~w(.push.services.mozilla.com .notify.windows.com .push.apple.com)

  schema "push_subscriptions" do
    belongs_to :user, User
    belongs_to :session, Session
    field :endpoint, :string
    field :p256dh, :string
    field :auth, :string
    field :locale, :string, default: "tr"

    timestamps(type: :utc_datetime)
  end

  def changeset(subscription, attrs) do
    subscription
    |> cast(attrs, [:endpoint, :p256dh, :auth, :locale])
    |> validate_required([:endpoint, :p256dh, :auth])
    |> validate_length(:endpoint, max: 2048)
    |> validate_change(:endpoint, fn :endpoint, endpoint ->
      if push_service?(endpoint), do: [], else: [endpoint: "is not a supported push service"]
    end)
    |> validate_key(:p256dh, fn key ->
      byte_size(key) == 65 and binary_part(key, 0, 1) == <<4>>
    end)
    |> validate_key(:auth, fn key -> byte_size(key) == 16 end)
    |> validate_inclusion(:locale, ~w(tr en))
  end

  @doc "Whether `endpoint` is an https URL on one of the browsers' push services."
  def push_service?(endpoint) when is_binary(endpoint) do
    case URI.parse(endpoint) do
      %URI{scheme: "https", host: host, port: 443, userinfo: nil} when is_binary(host) ->
        host = String.downcase(host)
        host in @push_hosts or Enum.any?(@push_host_suffixes, &String.ends_with?(host, &1))

      _ ->
        false
    end
  end

  def push_service?(_endpoint), do: false

  @doc "A key as the browser sends it (unpadded base64url) decoded, or :error."
  def decode_key(value) when is_binary(value), do: Base.url_decode64(value, padding: false)
  def decode_key(_value), do: :error

  defp validate_key(changeset, field, valid?) do
    validate_change(changeset, field, fn ^field, value ->
      if key_valid?(value, valid?), do: [], else: [{field, "is invalid"}]
    end)
  end

  defp key_valid?(value, valid?) do
    case decode_key(value) do
      {:ok, key} -> valid?.(key)
      :error -> false
    end
  end
end
