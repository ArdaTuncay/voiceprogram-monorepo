defmodule Backend.Accounts.UserNotifier do
  @moduledoc """
  Sends account-related transactional emails via `Backend.Mailer`.

  Each email is written in the language of the request that triggered it —
  every one of these is sent synchronously from a request's own process,
  where `BackendWeb.LocalePlug` has set the gettext locale. Both bodies come
  from one list of blocks (see `deliver/3`), so the HTML and plain-text
  versions can't drift apart, and every value is HTML-escaped in the HTML
  one.
  """

  use Gettext, backend: BackendWeb.Gettext

  import Swoosh.Email

  alias Backend.Accounts.User

  @doc """
  Sends `user` an email verification link carrying `token` (as produced by
  `Backend.Accounts.generate_email_verification_token/1`). The link points
  at the *frontend's* `/verify-email/:token` route (see
  `config :backend, :frontend_url` in runtime.exs, sourced from the same
  `FRONTEND_URL` env var as prod's CORS/WebSocket origin check) —
  `VerifyEmailPage` there is what actually calls `GET
  /api/verify-email/:token` and shows the result; a link straight to the
  backend would just dump raw JSON in the user's browser.

  Returns `{:ok, term}` on successful handoff to the configured adapter, or
  `{:error, term}` otherwise (see `Swoosh.Mailer.deliver/2`).
  """
  def deliver_verification_email(%User{} = user, token) when is_binary(token) do
    url = frontend_url("/verify-email/" <> token)

    deliver(user.email, gettext("Zircle - Verify Your Email Address"), [
      greeting(user),
      gettext("You need to verify your email address to start using your Zircle account."),
      {:link, gettext("Verify my email address"), url},
      gettext("If you didn't ask for this, you can ignore this email.")
    ])
  end

  @doc """
  Sends `user` a password reset link carrying `token` (see
  `Backend.Accounts.request_password_reset/1`). Like the verification link,
  it points at the frontend (`ResetPasswordPage`), which asks for the new
  password and calls `POST /api/password-reset/confirm`.
  """
  def deliver_password_reset_email(%User{} = user, token) when is_binary(token) do
    url = frontend_url("/reset-password/" <> token)

    deliver(user.email, gettext("Zircle - Password Reset"), [
      greeting(user),
      gettext("We received a request to reset the password for your Zircle account."),
      {:link, gettext("Set a new password"), url},
      gettext("This link is valid for 1 hour and can only be used once."),
      gettext(
        "If you didn't make this request, you can ignore this email; your password won't change."
      )
    ])
  end

  @doc """
  Sends the confirmation link for a pending email change to the NEW
  address (`user.pending_email`). Points at the frontend's
  `/confirm-email/:token` page, which calls
  `POST /api/account/email/confirm`.
  """
  def deliver_email_change_confirmation(%User{pending_email: new_email} = user, token)
      when is_binary(new_email) and is_binary(token) do
    url = frontend_url("/confirm-email/" <> token)

    deliver(new_email, gettext("Zircle - Confirm Your New Email Address"), [
      greeting(user),
      gettext("You asked to change your Zircle account's email address to this one."),
      {:link, gettext("Confirm this address"), url},
      gettext("The link is valid for 24 hours. Your old address stays in use until you confirm."),
      gettext("If you didn't ask for this, you can ignore this email.")
    ])
  end

  @doc """
  Tells the CURRENT address that a change to `user.pending_email` was
  requested — the real owner's heads-up if it wasn't them.
  """
  def deliver_email_change_notice(%User{pending_email: new_email} = user)
      when is_binary(new_email) do
    deliver(user.email, gettext("Zircle - Email Change Request"), [
      greeting(user),
      gettext(
        "We received a request to change your Zircle account's email address to %{email}. " <>
          "The change takes effect once the link sent to the new address is confirmed.",
        email: new_email
      ),
      gettext(
        "If you didn't make this request, your account may be at risk: change your password " <>
          "right away and sign out of all devices."
      )
    ])
  end

  defp greeting(%User{username: username}), do: gettext("Hi %{name},", name: username)

  defp frontend_url(path), do: Application.fetch_env!(:backend, :frontend_url) <> path

  # Blocks are paragraphs (strings) or `{:link, label, url}`.
  defp deliver(to, subject, blocks) do
    new()
    |> from(Application.fetch_env!(:backend, :mailer_from))
    |> to(to)
    |> subject(subject)
    |> html_body(Enum.map_join(blocks, "\n", &html_block/1))
    |> text_body(Enum.map_join(blocks, "\n\n", &text_block/1) <> "\n")
    |> Backend.Mailer.deliver()
  end

  defp html_block({:link, label, url}),
    do: ~s(<p><a href="#{escape(url)}">#{escape(label)}</a></p>)

  defp html_block(text), do: "<p>#{escape(text)}</p>"

  defp text_block({:link, label, url}), do: "#{label}:\n#{url}"
  defp text_block(text), do: text

  defp escape(text), do: Plug.HTML.html_escape(text)
end
