import { useState } from 'react';
import type { FormEvent } from 'react';
import { requestPasswordReset } from '../services/api';
import mascot from '../assets/zircle-mascot.svg';
import './Auth.css';

interface Props {
  initialEmail: string;
  onBackToLogin: () => void;
}

type State = 'idle' | 'sending' | 'sent' | 'error';

/** The "Şifremi unuttum" screen inside Auth. Asks for the address and
 * requests a reset link; the confirmation copy is the same whether or not
 * the address is registered, matching the backend's anti-enumeration
 * response (see BackendWeb.PasswordResetController). */
export default function ForgotPasswordScreen({ initialEmail, onBackToLogin }: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<State>('idle');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setState('sending');
    const result = await requestPasswordReset(email.trim());
    setState(result.error ? 'error' : 'sent');
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src={mascot} alt="Zircle maskotu" className="auth-mascot" />
        <h1>Şifremi unuttum</h1>

        {state === 'sent' ? (
          <p className="subtitle">
            <strong>{email.trim()}</strong> adresi kayıtlıysa, şifre sıfırlama bağlantısı gönderdik.
            Bağlantı 1 saat geçerlidir — gelen kutunuzda görünmüyorsa spam/gereksiz klasörünü de
            kontrol edin.
          </p>
        ) : (
          <>
            <p className="subtitle">
              Hesabınızın e-posta adresini girin, size yeni şifre belirlemeniz için bir bağlantı
              gönderelim.
            </p>
            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="forgot-email">E-posta</label>
                <input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              {state === 'error' && (
                <div className="auth-error" role="alert">
                  İstek gönderilemedi, lütfen biraz sonra tekrar deneyin.
                </div>
              )}

              <button type="submit" className="auth-submit" disabled={state === 'sending'}>
                {state === 'sending' ? 'Gönderiliyor…' : 'Sıfırlama bağlantısı gönder'}
              </button>
            </form>
          </>
        )}

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
