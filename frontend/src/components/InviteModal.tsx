import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { createInvite } from '../services/api';
import { useServerStore } from '../stores/useServerStore';
import { useT } from '../i18n';
import { inviteLink } from '../utils/inviteLink';
import Modal from './Modal';
import './InviteModal.css';

interface Props {
  onClose: () => void;
}

export default function InviteModal({ onClose }: Props) {
  const t = useT();
  const serverId = useServerStore((s) => s.activeServerId);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    setLoading(true);
    createInvite(serverId).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setError(error ?? t('Davet kodu oluşturulamadı'));
      } else {
        setCode(data.code);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [serverId, t]);

  const link = code ? inviteLink(code) : '';

  async function handleCopy(text: string, which: 'link' | 'code') {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <Modal title={t('İnsanları Davet Et')} onClose={onClose}>
      <p className="invite-description">
        {t('Bu bağlantıyı ya da kodu paylaşarak arkadaşlarını sunucuna davet edebilirsin.')}
      </p>

      {loading && <div className="invite-status">{t('Davet kodu oluşturuluyor…')}</div>}
      {error && <div className="invite-status invite-error"><AlertTriangle size={14} /> {error}</div>}

      {!loading && !error && (
        <>
          <label className="invite-label" htmlFor="invite-link">
            {t('Davet bağlantısı')}
          </label>
          <div className="invite-code-row">
            <input
              id="invite-link"
              className="invite-code-input invite-link-input"
              value={link}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <button className="invite-copy-btn" onClick={() => handleCopy(link, 'link')}>
              {copied === 'link' ? t('Kopyalandı!') : t('Kopyala')}
            </button>
          </div>
          <label className="invite-label" htmlFor="invite-code">
            {t('Davet kodu')}
          </label>
          <div className="invite-code-row">
            <input id="invite-code" className="invite-code-input" value={code} readOnly onFocus={(e) => e.target.select()} />
            <button className="invite-copy-btn" onClick={() => handleCopy(code, 'code')}>
              {copied === 'code' ? t('Kopyalandı!') : t('Kopyala')}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
