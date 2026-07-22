import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { createInvite } from '../services/api';
import { useServerStore } from '../stores/useServerStore';
import Modal from './Modal';
import './InviteModal.css';

interface Props {
  onClose: () => void;
}

export default function InviteModal({ onClose }: Props) {
  const serverId = useServerStore((s) => s.activeServerId);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    setLoading(true);
    createInvite(serverId).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setError(error ?? 'Davet kodu oluşturulamadı');
      } else {
        setCode(data.code);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal title="İnsanları Davet Et" onClose={onClose}>
      <p className="invite-description">
        Bu kodu paylaşarak arkadaşlarını sunucuna davet edebilirsin.
      </p>

      {loading && <div className="invite-status">Davet kodu oluşturuluyor…</div>}
      {error && <div className="invite-status invite-error"><AlertTriangle size={14} /> {error}</div>}

      {!loading && !error && (
        <div className="invite-code-row">
          <input className="invite-code-input" value={code} readOnly onFocus={(e) => e.target.select()} />
          <button className="invite-copy-btn" onClick={handleCopy}>
            {copied ? 'Kopyalandı!' : 'Kopyala'}
          </button>
        </div>
      )}
    </Modal>
  );
}
