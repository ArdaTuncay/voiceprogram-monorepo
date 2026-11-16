import { useEffect, useRef, useState } from 'react';
import { confirmEmailChange } from '../services/api';
import { useT, type MessageKey } from '../i18n';
import mascot from '../assets/zircle-mascot.svg';
import './VerifyEmailPage.css';

interface Props {
  token: string;
}

type Status = 'loading' | 'success' | 'invalid_token' | 'token_expired' | 'taken' | 'error';

const COPY: Record<Exclude<Status, 'loading'>, { title: MessageKey; body: MessageKey }> = {
  success: {
    title: 'E-posta adresin güncellendi',
    body: 'Bundan sonra bu adresle giriş yapabilirsin.',
  },
  invalid_token: {
    title: 'Bağlantı geçersiz',
    body: 'Bu onay bağlantısı geçersiz — daha önce kullanılmış ya da yerine yeni bir değişiklik istenmiş olabilir.',
  },
  token_expired: {
    title: 'Bağlantının süresi dolmuş',
    body: 'Onay bağlantıları 24 saat geçerlidir. Ayarlar → Hesabım bölümünden değişikliği yeniden isteyebilirsin.',
  },
  taken: {
    title: 'Bu adres artık kullanılamıyor',
    body: 'Sen onaylamadan önce bu e-posta adresi başka bir hesap tarafından alınmış. E-posta adresin değişmedi.',
  },
  error: {
    title: 'Bir şeyler ters gitti',
    body: 'Onay sırasında beklenmeyen bir hata oluştu, lütfen bağlantıyı tekrar açmayı dene.',
  },
};

/** Mounted by App.tsx for `/confirm-email/:token` — the link mailed to the
 * NEW address when someone asks to change their account email (see
 * Backend.Accounts.request_email_change/2). Calls
 * `POST /api/account/email/confirm` once on mount.
 *
 * The request is a POST made from JS, never a bare GET link, so a mail
 * provider's link scanner opening the URL can't apply the change on its
 * own. And it's sent only once even though React StrictMode runs effects
 * twice in development: the token is single-use, so a second call would
 * come back `invalid_token` and overwrite the real result. */
export default function ConfirmEmailChangePage({ token }: Props) {
  const t = useT();
  const [status, setStatus] = useState<Status>('loading');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    confirmEmailChange(token).then((result) => {
      if (result.data) setStatus('success');
      else if (result.error === 'invalid_token' || result.error === 'token_expired') setStatus(result.error);
      else if (result.error?.includes('has already been taken')) setStatus('taken');
      else setStatus('error');
    });
  }, [token]);

  return (
    <div className="verify-email-page">
      <div className="verify-email-card">
        <img src={mascot} alt={t('Zircle maskotu')} className="verify-email-mascot" />

        {status === 'loading' ? (
          <p className="verify-email-loading">{t('Onaylanıyor…')}</p>
        ) : (
          <>
            <h1>{t(COPY[status].title)}</h1>
            <p className="subtitle">{t(COPY[status].body)}</p>
            <button
              type="button"
              className="verify-email-submit"
              onClick={() => {
                window.location.href = '/';
              }}
            >
              {t("Zircle'a dön")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
