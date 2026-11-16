import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import mascot from '../assets/zircle-mascot.svg';
import { t } from '../i18n';
import './VerifyEmailPage.css';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Top-level safety net (see main.tsx). Without it, an error thrown while
 * rendering any component unmounts the whole React tree and leaves the user
 * staring at a blank page with no way forward. This shows a short message
 * and a reload button instead.
 *
 * Only catches render/lifecycle errors — event handlers and async code
 * (socket callbacks, fetches) don't propagate here, which is fine: those
 * already surface their own error states. When a frontend error tracker is
 * added, `componentDidCatch` is where it should report. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Yakalanmamış arayüz hatası:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    // A class component can't use hooks; the language can't change while
    // this screen is up anyway, so reading it once per render is enough.
    return (
      <div className="verify-email-page" role="alert">
        <div className="verify-email-card">
          <img src={mascot} alt={t('Zircle maskotu')} className="verify-email-mascot" />
          <h1>{t('Bir şeyler ters gitti')}</h1>
          <p className="subtitle">
            {t(
              'Beklenmeyen bir hata oluştu. Sayfayı yenilemek genellikle sorunu çözer; mesajların ve sunucuların kaybolmadı.'
            )}
          </p>
          <button
            type="button"
            className="verify-email-submit"
            onClick={() => window.location.reload()}
          >
            {t('Sayfayı yenile')}
          </button>
        </div>
      </div>
    );
  }
}
