import { useEffect, useState } from 'react';
import { Laptop, Smartphone } from 'lucide-react';
import type { ActiveSession } from '../types';
import { fetchSessions, revokeSession } from '../services/api';
import { describeDevice } from '../utils/device';
import { currentLocale, useT } from '../i18n';
import './ActiveSessions.css';

function formatWhen(iso: string): string {
  const date = new Date(iso.includes('Z') ? iso : `${iso}Z`);
  return date.toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

const MOBILE = /iPhone|iPad|Android/;

/** Settings → Privacy & Safety: every device signed in to this account
 * (see Backend.Accounts.Session), and a way to sign any of them out — or
 * all but this one. Signing a session out drops its connection at once. */
export default function ActiveSessions() {
  const t = useT();
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [error, setError] = useState('');
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetchSessions().then(({ data, error }) => {
      if (cancelled) return;
      if (data) setSessions(data);
      else setError(error ?? t('Oturumlar alınamadı'));
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function signOut(ids: string[]) {
    setError('');
    setBusyIds((prev) => new Set([...prev, ...ids]));
    const results = await Promise.all(ids.map(async (id) => ({ id, ...(await revokeSession(id)) })));
    const ended = new Set(results.filter((r) => !r.error).map((r) => r.id));
    const failure = results.find((r) => r.error);

    setSessions((prev) => prev?.filter((s) => !ended.has(s.id)) ?? prev);
    setBusyIds((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
    if (failure?.error) setError(failure.error);
  }

  if (!sessions) {
    return error ? <p className="user-settings-placeholder">{error}</p> : <p className="user-settings-placeholder">{t('Yükleniyor…')}</p>;
  }

  const others = sessions.filter((s) => !s.current);

  return (
    <div className="active-sessions">
      {error && <p className="account-form-message account-form-message-error">{error}</p>}
      <ul className="active-sessions-list">
        {sessions.map((s) => {
          const device = describeDevice(s.user_agent);
          const Icon = s.user_agent && MOBILE.test(s.user_agent) ? Smartphone : Laptop;
          return (
            <li key={s.id} className="active-session">
              <Icon size={20} className="active-session-icon" aria-hidden="true" />
              <div className="active-session-info">
                <span className="active-session-device">{device}</span>
                {s.current && <span className="active-session-badge">{t('Bu cihaz')}</span>}
                <span className="active-session-meta">
                  {s.ip ? `${s.ip} · ` : ''}
                  {t('Son etkinlik: {when}', { when: formatWhen(s.last_seen_at) })}
                </span>
              </div>
              {!s.current && (
                <button
                  type="button"
                  className="account-form-submit-btn active-session-revoke"
                  onClick={() => void signOut([s.id])}
                  disabled={busyIds.has(s.id)}
                  aria-label={t('{device} oturumunu kapat', { device })}
                >
                  {t('Oturumu kapat')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {others.length > 0 && (
        <button
          type="button"
          className="account-form-submit-btn account-delete-submit-btn"
          onClick={() => void signOut(others.map((s) => s.id))}
          disabled={others.every((s) => busyIds.has(s.id))}
        >
          {t('Diğer tüm oturumları kapat')}
        </button>
      )}
    </div>
  );
}
