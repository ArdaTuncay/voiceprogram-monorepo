import { useState } from 'react';
import { useServerStore } from '../stores/useServerStore';
import JoinServerModal from './JoinServerModal';
import CreateServerModal from './CreateServerModal';
import './ServerSidebar.css';

function serverInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
  return (initials || '?').toUpperCase();
}

export default function ServerSidebar() {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServerId = useServerStore((s) => s.setActiveServerId);
  const unreadServerIds = useServerStore((s) => s.unreadServerIds);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

  return (
    <aside className="server-sidebar">
      <button
        className={`server-icon home-icon${activeServerId === null ? ' active' : ''}`}
        onClick={() => setActiveServerId(null)}
        title="Direkt Mesajlar"
        aria-label="Direkt Mesajlar"
      >
        🏠
      </button>

      <div className="server-sidebar-divider" />

      <div className="server-icon-list">
        {servers.map((server) => (
          <button
            key={server.id}
            className={`server-icon${server.id === activeServerId ? ' active' : ''}`}
            onClick={() => setActiveServerId(server.id)}
            title={server.name}
          >
            {serverInitials(server.name)}
            {unreadServerIds.has(server.id) && <span className="server-unread-badge" />}
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

      {showCreateModal && <CreateServerModal onClose={() => setShowCreateModal(false)} />}

      {showJoinModal && <JoinServerModal onClose={() => setShowJoinModal(false)} />}
    </aside>
  );
}
