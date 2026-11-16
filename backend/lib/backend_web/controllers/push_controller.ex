defmodule BackendWeb.PushController do
  @moduledoc """
  This browser's Web Push subscription (see `Backend.Push`): whether it's
  available and with what key, subscribe, unsubscribe. A subscription
  belongs to the session that made it, so signing that device out ends it.
  """
  use BackendWeb, :controller

  alias Backend.Push

  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 20, key: :current_user]
       when action in [:subscribe, :unsubscribe]

  @doc "GET /api/push — `%{enabled, public_key}`."
  def show(conn, _params),
    do: json(conn, %{enabled: Push.enabled?(), public_key: Push.public_key()})

  @doc """
  POST /api/push/subscriptions — the browser's `PushSubscription.toJSON()`:
  `endpoint` and `keys: {p256dh, auth}`.
  """
  def subscribe(conn, %{"endpoint" => endpoint, "keys" => %{"p256dh" => p256dh, "auth" => auth}}) do
    if Push.enabled?() do
      attrs = %{"endpoint" => endpoint, "p256dh" => p256dh, "auth" => auth}
      locale = Gettext.get_locale(BackendWeb.Gettext)

      case Push.subscribe(
             conn.assigns.current_user.id,
             conn.assigns.current_session_id,
             attrs,
             locale
           ) do
        {:ok, _subscription} ->
          send_resp(conn, :no_content, "")

        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{
            errors: Ecto.Changeset.traverse_errors(changeset, fn {msg, _opts} -> msg end)
          })
      end
    else
      conn |> put_status(:not_found) |> json(%{error: "push_disabled"})
    end
  end

  def subscribe(conn, _params),
    do: conn |> put_status(:bad_request) |> json(%{error: "endpoint ve keys gerekli"})

  @doc "DELETE /api/push/subscriptions — `endpoint`."
  def unsubscribe(conn, params) do
    :ok = Push.unsubscribe(conn.assigns.current_user.id, params["endpoint"])
    send_resp(conn, :no_content, "")
  end
end
