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

  @doc """
  Sends the confirmation link for a pending email change to the NEW
  address (`user.pending_email`). Points at the frontend's
  `/confirm-email/:token` page, which calls
  `POST /api/account/email/confirm`.
  """
  def deliver_email_change_confirmation(%User{pending_email: new_email} = user, token)
      when is_binary(new_email) and is_binary(token) do
    confirm_url = Application.fetch_env!(:backend, :frontend_url) <> "/confirm-email/" <> token

    new()
    |> from(Application.fetch_env!(:backend, :mailer_from))
    |> to(new_email)
    |> subject("Zircle - Yeni E-posta Adresini Onayla")
    |> html_body("""
    <p>Merhaba #{user.username},</p>
    <p>Zircle hesabınızın e-posta adresini bu adresle değiştirmek istediniz.</p>
    <p><a href="#{confirm_url}">Bu adresi onayla</a></p>
    <p>Bağlantı 24 saat geçerlidir. Onaylayana kadar eski adresiniz geçerli kalır.</p>
    <p>Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>
    """)
    |> text_body("""
    Merhaba #{user.username},

    Zircle hesabınızın e-posta adresini bu adresle değiştirmek istediniz. Onaylamak için:
    #{confirm_url}

    Bağlantı 24 saat geçerlidir. Onaylayana kadar eski adresiniz geçerli kalır.
    Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.
    """)
    |> Backend.Mailer.deliver()
  end

  @doc """
  Tells the CURRENT address that a change to `user.pending_email` was
  requested — the real owner's heads-up if it wasn't them.
  """
  def deliver_email_change_notice(%User{pending_email: new_email} = user)
      when is_binary(new_email) do
    new()
    |> from(Application.fetch_env!(:backend, :mailer_from))
    |> to(user.email)
    |> subject("Zircle - E-posta Değişikliği Talebi")
    |> html_body("""
    <p>Merhaba #{user.username},</p>
    <p>Zircle hesabınızın e-posta adresini <strong>#{new_email}</strong> olarak değiştirmek için bir talep aldık. Değişiklik, yeni adrese gönderilen bağlantı onaylanınca uygulanacak.</p>
    <p>Bu talebi siz yapmadıysanız hesabınız tehlikede olabilir: hemen şifrenizi değiştirin ve tüm cihazlardan çıkış yapın.</p>
    """)
    |> text_body("""
    Merhaba #{user.username},

    Zircle hesabınızın e-posta adresini #{new_email} olarak değiştirmek için bir talep aldık. Değişiklik, yeni adrese gönderilen bağlantı onaylanınca uygulanacak.

    Bu talebi siz yapmadıysanız hesabınız tehlikede olabilir: hemen şifrenizi değiştirin ve tüm cihazlardan çıkış yapın.
    """)
    |> Backend.Mailer.deliver()
  end
end
