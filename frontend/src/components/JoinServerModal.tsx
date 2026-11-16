import { useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useServerStore } from '../stores/useServerStore';
import { useT } from '../i18n';
import Modal from './Modal';
import './JoinServerModal.css';

interface Props {
  onClose: () => void;
}

export default function JoinServerModal({ onClose }: Props) {
  const t = useT();
  const joinServerByInvite = useServerStore((s) => s.joinServerByInvite);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;

    setSubmitting(true);
    const errorMessage = await joinServerByInvite(trimmed);
    setSubmitting(false);

    if (errorMessage) {
      setError(errorMessage);
      return;
    }

    onClose();
  }

  return (
    <Modal title={t('Bir Sunucuya Katıl')} onClose={onClose}>
      <p className="join-description">{t('Bir arkadaşından aldığın davet kodunu aşağıya gir.')}</p>
      <form className="join-form" onSubmit={handleSubmit}>
        <input
          autoFocus
          className="join-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t('Davet kodu')}
          disabled={submitting}
        />
        {error && <div className="join-error"><AlertTriangle size={14} /> {error}</div>}
        <button className="join-submit-btn" type="submit" disabled={submitting || !code.trim()}>
          {submitting ? t('Katılınıyor…') : t('Katıl')}
        </button>
      </form>
    </Modal>
  );
}
