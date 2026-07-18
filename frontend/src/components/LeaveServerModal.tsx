import { useState } from 'react';
import { useServerStore } from '../stores/useServerStore';
import Modal from './Modal';
import './LeaveServerModal.css';

interface Props {
  onClose: () => void;
}

export default function LeaveServerModal({ onClose }: Props) {
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
    <Modal title="Sunucudan Ayrıl" onClose={onClose}>
      <p className="leave-server-description">
        <strong>{server.name}</strong> sunucusundan ayrılmak istediğine emin misin? Tekrar
        katılmak için yeni bir davet linkine ihtiyacın olacak.
      </p>
      {error && <div className="leave-server-error">⚠ {error}</div>}
      <div className="leave-server-actions">
        <button className="leave-server-cancel-btn" onClick={onClose} disabled={leaving}>
          Vazgeç
        </button>
        <button className="leave-server-confirm-btn" onClick={handleLeave} disabled={leaving}>
          {leaving ? 'Ayrılınıyor…' : 'Sunucudan Ayrıl'}
        </button>
      </div>
    </Modal>
  );
}
