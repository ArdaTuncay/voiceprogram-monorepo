import { useRef, useState } from 'react';
import { Home, Plus, LogIn } from 'lucide-react';
import { useServerStore } from '../stores/useServerStore';
import { serverInitials } from '../utils';
import JoinServerModal from './JoinServerModal';
import CreateServerModal from './CreateServerModal';
import RadialServerSwitcher from './RadialServerSwitcher';
import './ServerSidebar.css';

export default function ServerSidebar() {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServerId = useServerStore((s) => s.setActiveServerId);
  const unreadServerIds = useServerStore((s) => s.unreadServerIds);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const homeButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <aside className="server-sidebar">
      <button
        ref={homeButtonRef}
        className={`server-icon home-icon${activeServerId === null ? ' active' : ''}`}
        onClick={() => setActiveServerId(null)}
        title="Direkt Mesajlar"
        aria-label="Direkt Mesajlar"
      >
        <Home size={20} />
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
          <Plus size={24} />
        </button>

        <button
          className="server-icon server-icon-join"
          onClick={() => setShowJoinModal(true)}
          title="Bir Sunucuya Katıl"
          aria-label="Bir Sunucuya Katıl"
        >
          <LogIn size={18} />
        </button>
      </div>

      {showCreateModal && <CreateServerModal onClose={() => setShowCreateModal(false)} />}

      {showJoinModal && <JoinServerModal onClose={() => setShowJoinModal(false)} />}

      {/* Optional layer on top of the plain rail above — long-press the
          home button to quick-switch servers radially. Doesn't touch any
          of the rail's own rendering/behavior. */}
      <RadialServerSwitcher
        servers={servers}
        activeServerId={activeServerId}
        onSelectServer={setActiveServerId}
        triggerRef={homeButtonRef}
      />
    </aside>
  );
}
