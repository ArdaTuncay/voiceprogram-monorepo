import { useRef, useState } from 'react';
import { Home, Plus, LogIn, Users } from 'lucide-react';
import { useServerStore } from '../stores/useServerStore';
import { serverInitials } from '../utils';
import JoinServerModal from './JoinServerModal';
import CreateServerModal from './CreateServerModal';
import RadialServerSwitcher from './RadialServerSwitcher';
import './ServerSidebar.css';

interface Props {
  /** Whether the standalone Arkadaşlar (Friends) view is currently open —
   * mutually exclusive with the Home/DM icon's active state. */
  friendsActive: boolean;
  onSelectFriends: () => void;
  /** Called whenever Home or a server icon is clicked, so the parent can
   * close the Friends view — those destinations already own their own
   * activeServerId change, this just handles the one piece of state
   * (friendsActive) that lives outside this component. */
  onNavigate: () => void;
}

export default function ServerSidebar({ friendsActive, onSelectFriends, onNavigate }: Props) {
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
        className={`server-icon home-icon${activeServerId === null && !friendsActive ? ' active' : ''}`}
        onClick={() => {
          onNavigate();
          setActiveServerId(null);
        }}
        title="Direkt Mesajlar"
        aria-label="Direkt Mesajlar"
      >
        <Home size={20} strokeWidth={2} />
      </button>

      <button
        className={`server-icon home-icon${friendsActive ? ' active' : ''}`}
        onClick={onSelectFriends}
        title="Arkadaşlar"
        aria-label="Arkadaşlar"
      >
        <Users size={20} strokeWidth={2} />
      </button>

      <div className="server-sidebar-divider" />

      <div className="server-icon-list">
        {servers.map((server) => (
          <button
            key={server.id}
            className={`server-icon${server.id === activeServerId ? ' active' : ''}`}
            onClick={() => {
              onNavigate();
              setActiveServerId(server.id);
            }}
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
          <Plus size={20} strokeWidth={2} />
        </button>

        <button
          className="server-icon server-icon-join"
          onClick={() => setShowJoinModal(true)}
          title="Bir Sunucuya Katıl"
          aria-label="Bir Sunucuya Katıl"
        >
          <LogIn size={20} strokeWidth={2} />
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
