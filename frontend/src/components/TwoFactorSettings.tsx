import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type { TwoFactorSetup, TwoFactorStatus } from '../types';
import {
  disableTwoFactor,
  enableTwoFactor,
  fetchTwoFactorStatus,
  regenerateRecoveryCodes,
  startTwoFactorSetup,
} from '../services/api';
import { useT } from '../i18n';
import './TwoFactorSettings.css';

type Step =
  | { kind: 'idle' }
  | { kind: 'password' }
  | { kind: 'scan'; setup: TwoFactorSetup }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'confirm'; action: 'disable' | 'regenerate' };

/** Settings → Privacy & Safety: two-factor sign-in (see
 * Backend.Accounts.TwoFactor). Turning it on: current password → scan the
 * QR code (or type the key) → a code from the app → ten recovery codes,
 * shown this once. Turning it off, or replacing the recovery codes, takes
 * the password and a code. */
export default function TwoFactorSettings() {
  const t = useT();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTwoFactorStatus().then(({ data, error }) => {
      if (cancelled) return;
      if (data) setStatus(data);
      else setError(error ?? t('Bir hata oluştu'));
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  function go(next: Step) {
    setStep(next);
    setPassword('');
    setCode('');
    setError('');
  }

  async function run<T>(request: Promise<{ data?: T; error?: string }>, onData: (data: T) => void) {
    setBusy(true);
    setError('');
    const { data, error } = await request;
    setBusy(false);
    if (error) setError(error);
    else onData(data as T);
  }

  function submitPassword(e: FormEvent) {
    e.preventDefault();
    void run(startTwoFactorSetup(password), (setup) => go({ kind: 'scan', setup }));
  }

  function submitSetupCode(e: FormEvent, setup: TwoFactorSetup) {
    e.preventDefault();
    void run(enableTwoFactor(setup.setup_token, code.replace(/\s/g, '')), ({ recovery_codes }) => {
      go({ kind: 'codes', codes: recovery_codes });
      setStatus({ enabled: true, recovery_codes_left: recovery_codes.length });
    });
  }

  function submitConfirm(e: FormEvent, action: 'disable' | 'regenerate') {
    e.preventDefault();
    const cleanCode = code.replace(/\s/g, '');
    if (action === 'disable') {
      void run(disableTwoFactor(password, cleanCode), () => {
        go({ kind: 'idle' });
        setStatus({ enabled: false, recovery_codes_left: 0 });
      });
    } else {
      void run(regenerateRecoveryCodes(password, cleanCode), ({ recovery_codes }) => {
        go({ kind: 'codes', codes: recovery_codes });
        setStatus({ enabled: true, recovery_codes_left: recovery_codes.length });
      });
    }
  }

  async function copyCodes(codes: string[]) {
    await navigator.clipboard.writeText(codes.join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (!status) {
    return <p className="user-settings-placeholder">{error || t('Yükleniyor…')}</p>;
  }

  const errorLine = error && (
    <div className="account-form-message account-form-message-error" role="alert">
      <AlertTriangle size={14} /> {error}
    </div>
  );

  return (
    <div className="two-factor">
      <p className="two-factor-status">
        <ShieldCheck size={16} aria-hidden="true" className={status.enabled ? 'two-factor-on' : undefined} />
        <span className={status.enabled ? 'two-factor-on' : 'two-factor-off'}>
          {status.enabled ? t('Açık') : t('Kapalı')}
        </span>
        {status.enabled && step.kind !== 'codes' && (
          <span className="two-factor-hint">
            {t('{count} kurtarma kodu kaldı', { count: status.recovery_codes_left })}
          </span>
        )}
      </p>
      <p className="user-settings-placeholder">
        {t('Girişte şifrenin yanında, telefonundaki doğrulama uygulamasından (Google Authenticator, Authy, 1Password…) bir kod da istenir.')}
      </p>

      {step.kind === 'idle' && (
        <>
          {errorLine}
          {status.enabled ? (
            <div className="two-factor-actions">
              <button
                type="button"
                className="account-form-submit-btn"
                onClick={() => go({ kind: 'confirm', action: 'regenerate' })}
              >
                {t('Yeni kurtarma kodları')}
              </button>
              <button
                type="button"
                className="two-factor-cancel"
                onClick={() => go({ kind: 'confirm', action: 'disable' })}
              >
                {t('Devre dışı bırak')}
              </button>
            </div>
          ) : (
            <button type="button" className="account-form-submit-btn" onClick={() => go({ kind: 'password' })}>
              {t('Etkinleştir')}
            </button>
          )}
        </>
      )}

      {step.kind === 'password' && (
        <form className="account-form" onSubmit={submitPassword}>
          <label className="user-settings-label" htmlFor="two-factor-password">
            {t('Mevcut şifre')}
          </label>
          <input
            id="two-factor-password"
            type="password"
            className="account-form-input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <div className="two-factor-actions">
            <button className="account-form-submit-btn" type="submit" disabled={busy || !password}>
              {t('Devam et')}
            </button>
            <button type="button" className="two-factor-cancel" onClick={() => go({ kind: 'idle' })}>
              {t('Vazgeç')}
            </button>
          </div>
          {errorLine}
        </form>
      )}

      {step.kind === 'scan' && (
        <form className="account-form" onSubmit={(e) => submitSetupCode(e, step.setup)}>
          <p>{t('Doğrulama uygulamanla bu QR kodu tara ya da anahtarı elle gir:')}</p>
          <img
            className="two-factor-qr"
            src={step.setup.qr_data_uri}
            alt={t('Doğrulama uygulaması için QR kod')}
            width={200}
            height={200}
          />
          <code className="two-factor-secret">{step.setup.secret}</code>
          <label className="user-settings-label" htmlFor="two-factor-setup-code">
            {t('Doğrulama kodu')}
          </label>
          <input
            id="two-factor-setup-code"
            className="account-form-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={8}
            disabled={busy}
          />
          <div className="two-factor-actions">
            <button className="account-form-submit-btn" type="submit" disabled={busy || !code.trim()}>
              {t('Doğrula ve etkinleştir')}
            </button>
            <button type="button" className="two-factor-cancel" onClick={() => go({ kind: 'idle' })}>
              {t('Vazgeç')}
            </button>
          </div>
          {errorLine}
        </form>
      )}

      {step.kind === 'codes' && (
        <div className="account-form">
          <p>
            <strong>
              {t('Kurtarma kodlarını güvenli bir yere kaydet. Telefonuna erişemezsen girişte bunlardan birini kullanabilirsin; her biri bir kez geçerli. Bu kodları bir daha göremezsin.')}
            </strong>
          </p>
          <ul className="two-factor-codes">
            {step.codes.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
          <div className="two-factor-actions">
            <button type="button" className="two-factor-cancel" onClick={() => void copyCodes(step.codes)}>
              {copied ? t('Kopyalandı!') : t('Kopyala')}
            </button>
            <button type="button" className="account-form-submit-btn" onClick={() => go({ kind: 'idle' })}>
              {t('Kodları kaydettim')}
            </button>
          </div>
        </div>
      )}

      {step.kind === 'confirm' && (
        <form className="account-form" onSubmit={(e) => submitConfirm(e, step.action)}>
          {step.action === 'regenerate' && (
            <p>{t('Yeni kodlar oluşturulunca eski kurtarma kodlarının hepsi geçersiz olur.')}</p>
          )}
          <label className="user-settings-label" htmlFor="two-factor-disable-password">
            {t('Mevcut şifre')}
          </label>
          <input
            id="two-factor-disable-password"
            type="password"
            className="account-form-input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <label className="user-settings-label" htmlFor="two-factor-disable-code">
            {t('Doğrulama kodu ya da kurtarma kodu')}
          </label>
          <input
            id="two-factor-disable-code"
            className="account-form-input"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={16}
            disabled={busy}
          />
          <div className="two-factor-actions">
            <button
              className={`account-form-submit-btn${step.action === 'disable' ? ' account-delete-submit-btn' : ''}`}
              type="submit"
              disabled={busy || !password || !code.trim()}
            >
              {step.action === 'disable' ? t('Kapat') : t('Kodları yenile')}
            </button>
            <button type="button" className="two-factor-cancel" onClick={() => go({ kind: 'idle' })}>
              {t('Vazgeç')}
            </button>
          </div>
          {errorLine}
        </form>
      )}
    </div>
  );
}
