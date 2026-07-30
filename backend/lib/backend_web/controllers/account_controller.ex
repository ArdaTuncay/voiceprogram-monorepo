defmodule BackendWeb.AccountController do
  use BackendWeb, :controller

  alias Backend.Accounts
  alias Backend.Friends

  # Anti-brute-force guard on the current user's own account — keyed by the
  # authenticated caller (see BackendWeb.RateLimiterPlug), not a request
  # param, since there's no "target" here other than yourself. Covers all
  # four actions: none of these should be attempted more than a handful of
  # times a minute by a legitimate user.
  plug BackendWeb.RateLimiterPlug,
       [scale: :timer.minutes(1), limit: 5, key: :current_user]
       when action in [
              :update_username,
              :update_email,
              :update_password,
              :update_friend_request_privacy
            ]

  @doc """
  PATCH /api/account/username — requires the current password (Discord-
  style re-auth for a sensitive change), so a hijacked/stolen session token
  alone isn't enough to take over the account's identity.
  """
  def update_username(conn, %{"username" => username, "current_password" => current_password}) do
    user = conn.assigns.current_user

    if Accounts.verify_password?(user, current_password) do
      case Accounts.update_username(user, username) do
        {:ok, updated} ->
          json(conn, %{id: updated.id, username: updated.username, email: updated.email})

        {:error, changeset} ->
          conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
      end
    else
      conn |> put_status(:unauthorized) |> json(%{error: "Mevcut şifre yanlış"})
    end
  end

  def update_username(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "username ve current_password gerekli"})
  end

  @doc """
  PATCH /api/account/email — same current-password re-auth as
  update_username/2. Takes effect immediately, no confirmation link — see
  Backend.Accounts.User.email_changeset/2's moduledoc.
  """
  def update_email(conn, %{"email" => email, "current_password" => current_password}) do
    user = conn.assigns.current_user

    if Accounts.verify_password?(user, current_password) do
      case Accounts.update_email(user, email) do
        {:ok, updated} ->
          json(conn, %{id: updated.id, username: updated.username, email: updated.email})

        {:error, changeset} ->
          conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
      end
    else
      conn |> put_status(:unauthorized) |> json(%{error: "Mevcut şifre yanlış"})
    end
  end

  def update_email(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "email ve current_password gerekli"})
  end

  @doc """
  PATCH /api/account/password — verifies current_password itself (see
  Accounts.update_password/3), then invalidates every other session by
  bumping token_version. This request's own token was issued before the
  change too, so the client must re-authenticate afterwards just like
  every other device — see the frontend's handling of a successful
  response here (it treats it the same as a forced logout-elsewhere).
  """
  def update_password(conn, %{
        "current_password" => current_password,
        "new_password" => new_password
      }) do
    user = conn.assigns.current_user

    case Accounts.update_password(user, current_password, new_password) do
      {:ok, updated} ->
        json(conn, %{id: updated.id, username: updated.username, email: updated.email})

      {:error, :invalid_current_password} ->
        conn |> put_status(:unauthorized) |> json(%{error: "Mevcut şifre yanlış"})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  def update_password(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "current_password ve new_password gerekli"})
  end

  @doc """
  PATCH /api/account/friend-request-privacy — "everyone" or "nobody", no
  current-password re-auth (see Accounts.update_friend_request_privacy/2's
  moduledoc for why this differs from username/email/password above).
  """
  def update_friend_request_privacy(conn, %{"friend_request_privacy" => privacy}) do
    case Accounts.update_friend_request_privacy(conn.assigns.current_user, privacy) do
      {:ok, updated} ->
        json(conn, %{friend_request_privacy: updated.friend_request_privacy})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  def update_friend_request_privacy(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "friend_request_privacy gerekli"})
  end

  @doc "GET /api/account/blocked-users — lists everyone the current user has blocked."
  def list_blocked_users(conn, _params) do
    json(conn, Friends.list_blocked_users(conn.assigns.current_user.id))
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
