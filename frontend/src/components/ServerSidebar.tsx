import { useState } from 'react';
import type { Server } from '../types';
import JoinServerModal from './JoinServerModal';
import CreateServerModal from './CreateServerModal';
import './ServerSidebar.css';

interface Props {
  servers: Server[];
  activeServerId: string | null;
  onSelect: (serverId: string) => void;
  /** Returns an error message on failure, or `undefined` on success. */
  onCreate: (name: string) => Promise<string | undefined>;
  /** Returns an error message on failure, or `undefined` on success. */
  onJoin: (code: string) => Promise<string | undefined>;
}

function serverInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
  return (initials || '?').toUpperCase();
}

export default function ServerSidebar({ servers, activeServerId, onSelect, onCreate, onJoin }: Props) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

  return (
    <aside className="server-sidebar">
      <div className="server-icon-list">
        {servers.map((server) => (
          <button
            key={server.id}
            className={`server-icon${server.id === activeServerId ? ' active' : ''}`}
            onClick={() => onSelect(server.id)}
            title={server.name}
          >
            {serverInitials(server.name)}
          </button>
        ))}
      </div>

      <div className="server-create-area">
        <button
          className="server-icon server-icon-create"
          onClick={() => setShowCreateModal(true)}
          title="Sunucu Oluştur"
          aria-label="Sunucu Oluştur"
        >
          +
        </button>

        <button
          className="server-icon server-icon-join"
          onClick={() => setShowJoinModal(true)}
          title="Bir Sunucuya Katıl"
          aria-label="Bir Sunucuya Katıl"
        >
          ➜
        </button>
      </div>

      {showCreateModal && (
        <CreateServerModal onCreate={onCreate} onClose={() => setShowCreateModal(false)} />
      )}

      {showJoinModal && (
        <JoinServerModal onJoin={onJoin} onClose={() => setShowJoinModal(false)} />
      )}
    </aside>
  );
}
