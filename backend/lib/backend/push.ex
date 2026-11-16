defmodule Backend.Push do
  @moduledoc """
  Notifications that reach a user while Zircle is closed (Web Push): a DM,
  or an @mention in a server channel. Every message in every channel would
  be far too much for big servers, so only those two.

  Sent only when the user has no open Zircle at all (no `"user:<id>"`
  Presence, see `Backend.Accounts.online?/1`) — an open tab already shows
  its own notifications (see the frontend's useSocketStore), and doing both
  would notify twice.

  Configured with a VAPID key pair (`mix push.gen.vapid`) and a contact
  (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); without them
  this is off and the settings page doesn't offer it.

  Delivery runs under `Backend.TaskSupervisor`, off the channel process
  that sent the message (`delivery: :inline` in tests). A push service
  answering 404/410 means the browser dropped the subscription, so it's
  deleted. The text is written in the language the browser subscribed in.
  """

  use Gettext, backend: BackendWeb.Gettext

  import Ecto.Query
  require Logger

  alias Backend.Accounts
  alias Backend.Push.{Subscription, WebPush}
  alias Backend.Repo

  @max_per_user 10
  @body_limit 140
  @ttl 24 * 60 * 60

  @type message ::
          %{
            kind: :dm,
            dm_room_id: String.t(),
            sender: String.t() | nil,
            content: String.t(),
            file?: boolean()
          }
          | %{
              kind: :mention,
              server_id: String.t(),
              channel_id: String.t(),
              channel_name: String.t(),
              sender: String.t() | nil,
              content: String.t(),
              file?: boolean()
            }

  @doc "Whether VAPID keys are configured."
  def enabled?, do: is_binary(config(:vapid_public_key)) and is_binary(config(:vapid_private_key))

  @doc "The VAPID public key browsers subscribe with (unpadded base64url), or nil when off."
  def public_key, do: if(enabled?(), do: config(:vapid_public_key))

  @doc """
  Saves the browser subscription `attrs` (`endpoint`, `p256dh`, `auth`) for
  `user_id`, signed in as session `session_id` (nil for a token from before
  sessions existed). A browser has one endpoint, so subscribing again — or
  as someone else on the same browser — replaces the old row. Keeps the
  newest #{@max_per_user} per user.
  """
  def subscribe(user_id, session_id, attrs, locale) do
    changeset =
      %Subscription{user_id: user_id, session_id: session_id}
      |> Subscription.changeset(Map.put(attrs, "locale", locale))

    result =
      Repo.insert(changeset,
        on_conflict: {:replace, [:user_id, :session_id, :p256dh, :auth, :locale, :updated_at]},
        conflict_target: :endpoint,
        returning: true
      )

    with {:ok, _subscription} <- result do
      prune(user_id)
      result
    end
  end

  @doc "Removes `user_id`'s subscription for `endpoint` (this browser turning it off)."
  def unsubscribe(user_id, endpoint) when is_binary(endpoint) do
    Repo.delete_all(
      from s in Subscription, where: s.user_id == ^user_id and s.endpoint == ^endpoint
    )

    :ok
  end

  def unsubscribe(_user_id, _endpoint), do: :ok

  @doc "`user_id`'s subscriptions, newest first."
  def list_subscriptions(user_id) do
    Repo.all(from s in Subscription, where: s.user_id == ^user_id, order_by: [desc: s.updated_at])
  end

  @doc """
  Sends `message` to every browser of each of `user_ids` that isn't online
  right now. Returns immediately; delivery runs in the background.
  """
  @spec notify([String.t()] | String.t(), message()) :: :ok
  def notify(user_id, message) when is_binary(user_id), do: notify([user_id], message)

  def notify(user_ids, message) when is_list(user_ids) do
    offline = if enabled?(), do: Enum.reject(user_ids, &Accounts.online?/1), else: []
    if offline != [], do: run(fn -> deliver_all(offline, message) end)
    :ok
  end

  defp deliver_all(user_ids, message) do
    from(s in Subscription, where: s.user_id in ^user_ids)
    |> Repo.all()
    |> Enum.each(&deliver(&1, message))
  end

  @doc """
  Encrypts and sends `message` to one subscription. `:ok`, `:gone` (the
  subscription was deleted) or `{:error, reason}`.
  """
  def deliver(%Subscription{} = subscription, message) do
    with {:ok, ua_public} <- Subscription.decode_key(subscription.p256dh),
         {:ok, auth} <- Subscription.decode_key(subscription.auth) do
      payload =
        Gettext.with_locale(BackendWeb.Gettext, subscription.locale, fn -> payload(message) end)

      body = WebPush.encrypt(Jason.encode!(payload), ua_public, auth)

      subscription.endpoint
      |> post(body)
      |> handle_response(subscription)
    else
      _ -> {:error, :invalid_keys}
    end
  end

  @doc "What the service worker shows (see frontend/public/sw.js)."
  def payload(%{kind: :dm} = message) do
    %{
      title: message.sender || unknown(),
      body: body(message),
      tag: "dm:" <> message.dm_room_id,
      open: "dm:" <> message.dm_room_id
    }
  end

  def payload(%{kind: :mention} = message) do
    %{
      title:
        gettext("%{name} in #%{channel}",
          name: message.sender || unknown(),
          channel: message.channel_name
        ),
      body: body(message),
      tag: "channel:" <> message.channel_id,
      open: "channel:#{message.server_id}:#{message.channel_id}"
    }
  end

  defp body(%{content: content} = message) do
    case String.trim(content || "") do
      "" ->
        if message.file?, do: gettext("Sent a file"), else: ""

      text ->
        if String.length(text) > @body_limit,
          do: String.slice(text, 0, @body_limit - 1) <> "…",
          else: text
    end
  end

  defp unknown, do: gettext("Someone")

  defp post(endpoint, body) do
    authorization =
      WebPush.authorization(
        endpoint,
        config(:vapid_public_key),
        config(:vapid_private_key),
        config(:vapid_subject) || "mailto:no-reply@zircle.app"
      )

    [
      url: endpoint,
      body: body,
      headers: [
        {"authorization", authorization},
        {"content-encoding", "aes128gcm"},
        {"content-type", "application/octet-stream"},
        {"ttl", Integer.to_string(@ttl)},
        {"urgency", "high"}
      ],
      retry: false,
      receive_timeout: 10_000
    ]
    |> Keyword.merge(config(:req_options) || [])
    |> Req.post()
  end

  defp handle_response({:ok, %Req.Response{status: status}}, _subscription)
       when status in 200..299,
       do: :ok

  defp handle_response({:ok, %Req.Response{status: status}}, subscription)
       when status in [404, 410] do
    Repo.delete_all(from s in Subscription, where: s.id == ^subscription.id)
    :gone
  end

  defp handle_response({:ok, %Req.Response{status: status}}, subscription) do
    Logger.warning("Web Push reddedildi status=#{status} subscription_id=#{subscription.id}")
    {:error, {:status, status}}
  end

  defp handle_response({:error, reason}, subscription) do
    Logger.warning(
      "Web Push gönderilemedi subscription_id=#{subscription.id} reason=#{inspect(reason)}"
    )

    {:error, reason}
  end

  defp prune(user_id) do
    keep =
      from s in Subscription,
        where: s.user_id == ^user_id,
        order_by: [desc: s.updated_at, desc: s.inserted_at],
        limit: @max_per_user,
        select: s.id

    Repo.delete_all(
      from s in Subscription, where: s.user_id == ^user_id and s.id not in subquery(keep)
    )
  end

  defp run(fun) do
    if config(:delivery) == :inline,
      do: fun.(),
      else: Task.Supervisor.start_child(Backend.TaskSupervisor, fun)
  end

  defp config(key), do: Application.get_env(:backend, __MODULE__, [])[key]
end
