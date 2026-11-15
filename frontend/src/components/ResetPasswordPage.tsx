import { useState } from 'react';
import type { FormEvent } from 'react';
import { confirmPasswordReset } from '../services/api';
import mascot from '../assets/zircle-mascot.svg';
import './Auth.css';

interface Props {
  token: string;
}

type Outcome = 'form' | 'success' | 'invalid_token' | 'token_expired';

const MIN_PASSWORD_LENGTH = 8;

/** Mounted by App.tsx for the `/reset-password/:token` "route" — the link
 * in the password reset email (see Backend.Accounts.UserNotifier). Like
 * VerifyEmailPage it's opened from a mail client, so it reads and writes no
 * session state; after success the user logs in normally with the new
 * password (every old session was signed out by the reset). */
export default function ResetPasswordPage({ token }: Props) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>('form');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`);
      return;
    }
    if (password !== confirmation) {
      setError('Şifreler eşleşmiyor.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await confirmPasswordReset(token, password);
      if (result.data) {
        setOutcome('success');
      } else if (result.error === 'invalid_token' || result.error === 'token_expired') {
        setOutcome(result.error);
      } else {
        setError('Şifre güncellenemedi, lütfen tekrar deneyin.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const goToLogin = () => {
    window.location.href = '/';
  };

  if (outcome !== 'form') {
    const copy = {
      success: {
        title: 'Şifreniz güncellendi',
        body: 'Yeni şifrenizle giriş yapabilirsiniz. Güvenliğiniz için diğer tüm oturumlarınız kapatıldı.',
      },
      invalid_token: {
        title: 'Bağlantı geçersiz',
        body: 'Bu sıfırlama bağlantısı geçersiz — daha önce kullanılmış ya da yerine yenisi istenmiş olabilir. Giriş ekranından yeni bir bağlantı isteyebilirsiniz.',
      },
      token_expired: {
        title: 'Bağlantının süresi dolmuş',
        body: 'Sıfırlama bağlantıları 1 saat geçerlidir. Giriş ekranından yeni bir bağlantı isteyebilirsiniz.',
      },
    }[outcome];

    return (
      <div className="auth-page">
        <div className="auth-card">
          <img src={mascot} alt="Zircle maskotu" className="auth-mascot" />
          <h1>{copy.title}</h1>
          <p className="subtitle">{copy.body}</p>
          <button type="button" className="auth-submit" onClick={goToLogin}>
            Giriş ekranına git
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src={mascot} alt="Zircle maskotu" className="auth-mascot" />
        <h1>Yeni şifre belirle</h1>
        <p className="subtitle">Hesabınız için yeni bir şifre seçin.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="new-password">Yeni şifre</label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label htmlFor="new-password-confirmation">Yeni şifre (tekrar)</label>
            <input
              id="new-password-confirmation"
              type="password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
            />
          </div>

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? 'Kaydediliyor…' : 'Şifreyi güncelle'}
          </button>
        </form>
      </div>
    </div>
  );
}
