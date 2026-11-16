import { useState } from 'react';
import type { FormEvent } from 'react';
import type { User } from '../types';
import {
  loginUser,
  loginWithTwoFactor,
  registerUser,
  resendVerification,
} from '../services/api';
import { AUTH_REQUEST_ERRORS } from '../utils/errorMessages';
import { useT } from '../i18n';
import { rich } from '../i18n/rich';
import mascot from '../assets/zircle-mascot.svg';
import ForgotPasswordScreen from './ForgotPasswordScreen';
import LanguageSelect from './LanguageSelect';
import './Auth.css';

interface Props {
  onAuth: (user: User) => void;
}

type Mode = 'login' | 'register';

export default function Auth({ onAuth }: Props) {
  const t = useT();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Non-null once either a fresh registration or a login attempt has told
  // us this address needs verifying — set by two different call sites below
  // (register's own success, and login's "email_not_verified" error), which
  // is exactly why this is one shared screen/state rather than two: from
  // the user's point of view both cases are the same instruction ("go check
  // your email"), just reached by different doors.
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [forgotPassword, setForgotPassword] = useState(false);
  // Set when the password was right but the account wants a code too.
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    // services/api.ts's post() already never rejects and never stays pending
    // past its own timeout — this is a second, local guarantee on top of
    // that: whatever happens below, the button is never left stuck on
    // "Please wait…" with no error shown (PROJECT_ARCHITECTURE.md §7 #15).
    try {
      if (mode === 'register') {
        const result = await registerUser(username.trim(), email.trim(), password);

        if (result.error) {
          setError(result.error);
        } else if (result.data) {
          setPendingVerificationEmail(email.trim());
        }
        return;
      }

      const trimmedEmail = email.trim();
      const result = await loginUser(trimmedEmail, password);

      if (result.error === 'email_not_verified') {
        setPendingVerificationEmail(trimmedEmail);
      } else if (result.error) {
        setError(result.error);
      } else if (result.data) {
        if ('two_factor' in result.data) setTwoFactorChallenge(result.data.challenge);
        else onAuth(result.data);
      }
    } catch {
      setError(AUTH_REQUEST_ERRORS.unexpected);
    } finally {
      setLoading(false);
    }
  }

  function switchMode() {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError('');
  }

  if (pendingVerificationEmail) {
    return (
      <VerificationPendingScreen
        email={pendingVerificationEmail}
        onBackToLogin={() => {
          setPendingVerificationEmail(null);
          setMode('login');
        }}
      />
    );
  }

  if (twoFactorChallenge) {
    return (
      <TwoFactorLoginScreen
        challenge={twoFactorChallenge}
        onAuth={onAuth}
        onBackToLogin={() => {
          setTwoFactorChallenge(null);
          setPassword('');
        }}
      />
    );
  }

  if (forgotPassword) {
    return <ForgotPasswordScreen initialEmail={email} onBackToLogin={() => setForgotPassword(false)} />;
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <LanguageSelect className="language-select-corner" />
        <img src={mascot} alt={t('Zircle maskotu')} className="auth-mascot" />
        <h1>{mode === 'login' ? t('Tekrar hoş geldin!') : t('Hesap oluştur')}</h1>
        <p className="subtitle">
          {mode === 'login' ? t('Seni yeniden görmek güzel!') : t('Topluluğa bugün katıl.')}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label htmlFor="username">{t('Kullanıcı adı')}</label>
              <input
                id="username"
                type="text"
                placeholder={t('havalikullanici42')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={30}
                autoComplete="username"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">{t('E-posta')}</label>
            <input
              id="email"
              type="email"
              placeholder={t('sen@ornek.com')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">{t('Şifre')}</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? t('Lütfen bekle…') : mode === 'login' ? t('Giriş yap') : t('Devam et')}
          </button>
        </form>

        {mode === 'login' && (
          <p className="auth-toggle">
            <button type="button" onClick={() => setForgotPassword(true)}>
              {t('Şifremi unuttum')}
            </button>
          </p>
        )}

        <hr className="auth-divider" />

        <p className="auth-toggle">
          {mode === 'login' ? t('Hesabın yok mu?') : t('Zaten hesabın var mı?')}
          <button type="button" onClick={switchMode}>
            {mode === 'login' ? t('Kayıt ol') : t('Giriş yap')}
          </button>
        </p>
      </div>
    </div>
  );
}

type ResendState = 'idle' | 'sending' | 'sent' | 'error';

interface VerificationPendingScreenProps {
  email: string;
  onBackToLogin: () => void;
}

/** Shown after a fresh registration, or after a login attempt on an
 * unverified account (see Auth's `pendingVerificationEmail` state) — same
 * screen either way, since both boil down to "go check your email". Never
 * shows the backend's raw "email_not_verified"/enumeration-safe generic
 * message as-is; this owns its own copy. */
function VerificationPendingScreen({ email, onBackToLogin }: VerificationPendingScreenProps) {
  const t = useT();
  const [resendState, setResendState] = useState<ResendState>('idle');

  async function handleResend() {
    setResendState('sending');
    const result = await resendVerification(email);
    setResendState(result.error ? 'error' : 'sent');
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src={mascot} alt={t('Zircle maskotu')} className="auth-mascot" />
        <h1>{t('E-postanızı kontrol edin')}</h1>
        <p className="subtitle">
          {rich(
            t(
              '{email} adresine bir doğrulama bağlantısı gönderdik. Hesabınızı kullanmaya başlamak için gelen kutunuzdaki bağlantıya tıklayın — görünmüyorsa spam/gereksiz klasörünü de kontrol etmeyi unutmayın.'
            ),
            { email: <strong>{email}</strong> }
          )}
        </p>

        <div className="auth-resend-actions">
          {resendState === 'sent' && (
            <div className="auth-info">{t('Doğrulama e-postası tekrar gönderildi.')}</div>
          )}
          {resendState === 'error' && (
            <div className="auth-error">{t('Mail gönderilemedi, lütfen tekrar deneyin.')}</div>
          )}

          <button
            type="button"
            className="auth-submit"
            onClick={handleResend}
            disabled={resendState === 'sending'}
          >
            {resendState === 'sending' ? t('Gönderiliyor…') : t('Tekrar gönder')}
          </button>
        </div>

        <hr className="auth-divider" />

        <p className="auth-toggle">
          <button type="button" onClick={onBackToLogin}>
            {t('Giriş ekranına dön')}
          </button>
        </p>
      </div>
    </div>
  );
}

interface TwoFactorLoginScreenProps {
  challenge: string;
  onAuth: (user: User) => void;
  onBackToLogin: () => void;
}

/** The second step of a two-factor sign-in (see Backend.Accounts.TwoFactor):
 * the 6-digit code from the authenticator app, or one of the recovery codes
 * handed out when two-factor was turned on. The challenge from the first
 * step lasts five minutes; after that, back to the password. */
function TwoFactorLoginScreen({ challenge, onAuth, onBackToLogin }: TwoFactorLoginScreenProps) {
  const t = useT();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await loginWithTwoFactor(challenge, code.replace(/\s/g, ''));
      if (result.data) onAuth(result.data);
      else setError(result.error ?? AUTH_REQUEST_ERRORS.unexpected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src={mascot} alt={t('Zircle maskotu')} className="auth-mascot" />
        <h1>{t('İki adımlı doğrulama')}</h1>
        <p className="subtitle">
          {t('Doğrulama uygulamandaki 6 haneli kodu gir. Telefonuna erişemiyorsan kurtarma kodlarından birini kullanabilirsin.')}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="two-factor-code">{t('Doğrulama kodu')}</label>
            <input
              id="two-factor-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              required
              maxLength={16}
            />
          </div>

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="auth-submit" disabled={submitting || !code.trim()}>
            {submitting ? t('Lütfen bekle…') : t('Doğrula')}
          </button>
        </form>

        <hr className="auth-divider" />

        <p className="auth-toggle">
          <button type="button" onClick={onBackToLogin}>
            {t('Giriş ekranına dön')}
          </button>
        </p>
      </div>
    </div>
  );
}
