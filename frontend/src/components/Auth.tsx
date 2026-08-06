import { useState } from 'react';
import type { FormEvent } from 'react';
import type { User } from '../types';
import { registerUser, loginUser, resendVerification } from '../services/api';
import mascot from '../assets/zircle-mascot.svg';
import './Auth.css';

interface Props {
  onAuth: (user: User) => void;
}

type Mode = 'login' | 'register';

export default function Auth({ onAuth }: Props) {
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (mode === 'register') {
      const result = await registerUser(username.trim(), email.trim(), password);
      setLoading(false);

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setPendingVerificationEmail(email.trim());
      }
      return;
    }

    const trimmedEmail = email.trim();
    const result = await loginUser(trimmedEmail, password);
    setLoading(false);

    if (result.error === 'email_not_verified') {
      setPendingVerificationEmail(trimmedEmail);
    } else if (result.error) {
      setError(result.error);
    } else if (result.data) {
      onAuth(result.data);
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

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src={mascot} alt="Zircle maskotu" className="auth-mascot" />
        <h1>{mode === 'login' ? 'Welcome back!' : 'Create an account'}</h1>
        <p className="subtitle">
          {mode === 'login'
            ? "We're so excited to see you again!"
            : 'Join the community today.'}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                placeholder="cooluser42"
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
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
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
            {loading ? 'Please wait…' : mode === 'login' ? 'Log In' : 'Continue'}
          </button>
        </form>

        <hr className="auth-divider" />

        <p className="auth-toggle">
          {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
          <button type="button" onClick={switchMode}>
            {mode === 'login' ? 'Register' : 'Log In'}
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
  const [resendState, setResendState] = useState<ResendState>('idle');

  async function handleResend() {
    setResendState('sending');
    const result = await resendVerification(email);
    setResendState(result.error ? 'error' : 'sent');
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src={mascot} alt="Zircle maskotu" className="auth-mascot" />
        <h1>E-postanızı kontrol edin</h1>
        <p className="subtitle">
          <strong>{email}</strong> adresine bir doğrulama bağlantısı gönderdik. Hesabınızı
          kullanmaya başlamak için gelen kutunuzdaki bağlantıya tıklayın — görünmüyorsa spam/gereksiz
          klasörünü de kontrol etmeyi unutmayın.
        </p>

        <div className="auth-resend-actions">
          {resendState === 'sent' && (
            <div className="auth-info">Doğrulama e-postası tekrar gönderildi.</div>
          )}
          {resendState === 'error' && (
            <div className="auth-error">Mail gönderilemedi, lütfen tekrar deneyin.</div>
          )}

          <button
            type="button"
            className="auth-submit"
            onClick={handleResend}
            disabled={resendState === 'sending'}
          >
            {resendState === 'sending' ? 'Gönderiliyor…' : 'Tekrar gönder'}
          </button>
        </div>

        <hr className="auth-divider" />

        <p className="auth-toggle">
          <button type="button" onClick={onBackToLogin}>
            Giriş ekranına dön
          </button>
        </p>
      </div>
    </div>
  );
}
