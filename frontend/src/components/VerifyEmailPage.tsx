import { useEffect, useState } from 'react';
import { verifyEmail } from '../services/api';
import mascot from '../assets/zircle-mascot.svg';
import './VerifyEmailPage.css';

interface Props {
  token: string;
}

type Status = 'loading' | 'success' | 'invalid_token' | 'token_expired' | 'error';

interface StatusCopy {
  title: string;
  body: string;
}

function copyFor(status: Status, networkErrorDetail: string): StatusCopy {
  switch (status) {
    case 'success':
      return {
        title: 'E-postanız doğrulandı!',
        body: 'Artık Zircle hesabınıza giriş yapabilirsiniz.',
      };
    case 'invalid_token':
      return {
        title: 'Bağlantı geçersiz',
        body: 'Bu doğrulama bağlantısı geçersiz — daha önce kullanılmış ya da hiç var olmamış olabilir.',
      };
    case 'token_expired':
      return {
        title: 'Bağlantının süresi dolmuş',
        body: 'Bu doğrulama bağlantısının süresi doldu. Giriş ekranından yeniden bir bağlantı talep edebilirsiniz.',
      };
    case 'error':
      return {
        title: 'Bir şeyler ters gitti',
        body: networkErrorDetail || 'Doğrulama sırasında beklenmeyen bir hata oluştu, lütfen tekrar deneyin.',
      };
    case 'loading':
      return { title: '', body: '' };
  }
}

/** Mounted by App.tsx for the `/verify-email/:token` "route" (no client
 * router in this app — see App.tsx's own comment) — calls `GET
 * /api/verify-email/:token` once on mount and shows one of three outcomes.
 * Entirely isolated from the normal Auth/Chat tree: no session state is
 * read or written here, since the link is opened from an email client, not
 * from within a logged-in (or logged-out) app session. */
export default function VerifyEmailPage({ token }: Props) {
  const [status, setStatus] = useState<Status>('loading');
  const [networkErrorDetail, setNetworkErrorDetail] = useState('');

  useEffect(() => {
    let cancelled = false;

    verifyEmail(token).then((result) => {
      if (cancelled) return;

      if (result.data) {
        setStatus('success');
      } else if (result.error === 'invalid_token' || result.error === 'token_expired') {
        setStatus(result.error);
      } else {
        setNetworkErrorDetail(result.error ?? '');
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const { title, body } = copyFor(status, networkErrorDetail);

  return (
    <div className="verify-email-page">
      <div className="verify-email-card">
        <img src={mascot} alt="Zircle maskotu" className="verify-email-mascot" />

        {status === 'loading' ? (
          <p className="verify-email-loading">Doğrulanıyor…</p>
        ) : (
          <>
            <h1>{title}</h1>
            <p className="subtitle">{body}</p>

            {status === 'success' && (
              <button
                type="button"
                className="verify-email-submit"
                onClick={() => {
                  window.location.href = '/';
                }}
              >
                Giriş yap
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
