defmodule Backend.Accounts.UserNotifier do
  @moduledoc """
  Sends account-related transactional emails via `Backend.Mailer`.
  """

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
    frontend_url = Application.fetch_env!(:backend, :frontend_url)
    verification_url = frontend_url <> "/verify-email/" <> token

    new()
    |> from(Application.fetch_env!(:backend, :mailer_from))
    |> to(user.email)
    |> subject("Zircle - E-posta Adresini Doğrula")
    |> html_body("""
    <p>Merhaba #{user.username},</p>
    <p>Zircle hesabınızı kullanmaya başlamak için e-posta adresinizi doğrulamanız gerekiyor.</p>
    <p><a href="#{verification_url}">E-posta adresimi doğrula</a></p>
    <p>Bu bağlantıyı siz istemediyseniz bu e-postayı yok sayabilirsiniz.</p>
    """)
    |> text_body("""
    Merhaba #{user.username},

    Zircle hesabınızı kullanmaya başlamak için e-posta adresinizi doğrulamanız gerekiyor. Aşağıdaki bağlantıya tıklayın:

    #{verification_url}

    Bu bağlantıyı siz istemediyseniz bu e-postayı yok sayabilirsiniz.
    """)
    |> Backend.Mailer.deliver()
  end

  @doc """
  Sends `user` a password reset link carrying `token` (see
  `Backend.Accounts.request_password_reset/1`). Like the verification link,
  it points at the frontend (`ResetPasswordPage`), which asks for the new
  password and calls `POST /api/password-reset/confirm`.
  """
  def deliver_password_reset_email(%User{} = user, token) when is_binary(token) do
    reset_url = Application.fetch_env!(:backend, :frontend_url) <> "/reset-password/" <> token

    new()
    |> from(Application.fetch_env!(:backend, :mailer_from))
    |> to(user.email)
    |> subject("Zircle - Şifre Sıfırlama")
    |> html_body("""
    <p>Merhaba #{user.username},</p>
    <p>Zircle hesabınız için şifre sıfırlama talebi aldık.</p>
    <p><a href="#{reset_url}">Yeni şifre belirle</a></p>
    <p>Bu bağlantı 1 saat geçerlidir ve yalnızca bir kez kullanılabilir.</p>
    <p>Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz; şifreniz değişmez.</p>
    """)
    |> text_body("""
    Merhaba #{user.username},

    Zircle hesabınız için şifre sıfırlama talebi aldık. Yeni şifre belirlemek için:
    #{reset_url}

    Bu bağlantı 1 saat geçerlidir ve yalnızca bir kez kullanılabilir.
    Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz; şifreniz değişmez.
    """)
    |> Backend.Mailer.deliver()
  end
end
