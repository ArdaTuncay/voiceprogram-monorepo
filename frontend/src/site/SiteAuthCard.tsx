import type { User } from '../types';
import type { useAuthFlow } from '../hooks/useAuthFlow';
import { useT } from '../i18n';
import { TwoFactorLoginScreen, VerificationPendingScreen } from '../components/Auth';
import ForgotPasswordScreen from '../components/ForgotPasswordScreen';

interface Props {
  flow: ReturnType<typeof useAuthFlow>;
  onAuth: (user: User) => void;
}

/**
 * The sign-in / sign-up card in the home page's hero. Signing in here opens
 * Zircle in this same tab (App swaps the site for the app once there's a
 * user). The state lives in the page (see HomePage), so the closing
 * "Kayıt ol" button can switch this card to sign-up. The follow-up steps —
 * check your email, two-factor code, forgot password — are the app's own
 * screens, shown inside this card.
 */
export default function SiteAuthCard({ flow, onAuth }: Props) {
  const t = useT();
  const register = flow.mode === 'register';

  let body;
  if (flow.pendingVerificationEmail) {
    body = (
      <VerificationPendingScreen bare email={flow.pendingVerificationEmail} onBackToLogin={flow.leaveVerification} />
    );
  } else if (flow.twoFactorChallenge) {
    body = (
      <TwoFactorLoginScreen bare challenge={flow.twoFactorChallenge} onAuth={onAuth} onBackToLogin={flow.leaveTwoFactor} />
    );
  } else if (flow.forgotPassword) {
    body = <ForgotPasswordScreen bare initialEmail={flow.email} onBackToLogin={flow.closeForgotPassword} />;
  } else {
    body = (
      <div className="site-auth-main">
        <div className="site-auth-tabs">
          <button type="button" aria-pressed={!register} onClick={() => flow.setMode('login')}>
            {t('Giriş yap')}
          </button>
          <button type="button" aria-pressed={register} onClick={() => flow.setMode('register')}>
            {t('Kayıt ol')}
          </button>
        </div>

        <h2>{register ? t('Hesap oluştur') : t('Tekrar hoş geldin!')}</h2>

        <form className="site-auth-form" onSubmit={flow.handleSubmit}>
          {register && (
            <div className="site-field">
              <label htmlFor="site-username">{t('Kullanıcı adı')}</label>
              <input
                id="site-username"
                type="text"
                value={flow.username}
                onChange={(e) => flow.setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={30}
                autoComplete="username"
              />
            </div>
          )}

          <div className="site-field">
            <label htmlFor="site-email">{t('E-posta')}</label>
            <input
              id="site-email"
              type="email"
              placeholder={t('sen@ornek.com')}
              value={flow.email}
              onChange={(e) => flow.setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="site-field">
            <label htmlFor="site-password">{t('Şifre')}</label>
            <input
              id="site-password"
              type="password"
              value={flow.password}
              onChange={(e) => flow.setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={register ? 'new-password' : 'current-password'}
            />
          </div>

          {flow.error && (
            <div className="auth-error" role="alert">
              {flow.error}
            </div>
          )}

          <button type="submit" className="site-btn site-btn-primary site-auth-submit" disabled={flow.loading}>
            {flow.loading ? t('Lütfen bekle…') : register ? t('Kayıt ol') : t('Giriş yap ve tarayıcıda aç')}
          </button>
        </form>

        {register ? (
          <p className="site-auth-note">{t('Kayıt olduktan sonra e-postana bir doğrulama bağlantısı gönderilir.')}</p>
        ) : (
          <button type="button" className="site-auth-link" onClick={flow.openForgotPassword}>
            {t('Şifremi unuttum')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div id="giris" className="site-auth-card">
      {body}
    </div>
  );
}
