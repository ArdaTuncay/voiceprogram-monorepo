import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useServerStore } from '../stores/useServerStore';
import { useT } from '../i18n';
import { rich } from '../i18n/rich';
import Modal from './Modal';
import './LeaveServerModal.css';

interface Props {
  onClose: () => void;
}

export default function LeaveServerModal({ onClose }: Props) {
  const t = useT();
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const leaveServer = useServerStore((s) => s.leaveServer);
  const server = servers.find((s) => s.id === activeServerId);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);

  if (!server) return null;

  async function handleLeave() {
    setLeaving(true);
    setError('');
    const errorMessage = await leaveServer();
    setLeaving(false);

    if (errorMessage) {
      setError(errorMessage);
      return;
    }
    onClose();
  }

  return (
    <Modal title={t('Sunucudan Ayrıl')} onClose={onClose}>
      <p className="leave-server-description">
        {rich(
          t(
            '{server} sunucusundan ayrılmak istediğine emin misin? Tekrar katılmak için yeni bir davet linkine ihtiyacın olacak.'
          ),
          { server: <strong>{server.name}</strong> }
        )}
      </p>
      {error && <div className="leave-server-error"><AlertTriangle size={14} /> {error}</div>}
      <div className="leave-server-actions">
        <button className="leave-server-cancel-btn" onClick={onClose} disabled={leaving}>
          {t('Vazgeç')}
        </button>
        <button className="leave-server-confirm-btn" onClick={handleLeave} disabled={leaving}>
          {leaving ? t('Ayrılınıyor…') : t('Sunucudan Ayrıl')}
        </button>
      </div>
    </Modal>
  );
}
