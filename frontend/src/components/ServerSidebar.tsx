import { useRef, useState } from 'react';
import { Home, Users } from 'lucide-react';
import { useServerStore } from '../stores/useServerStore';
import { useDMStore } from '../stores/useDMStore';
import { serverInitials } from '../utils';
import { useT } from '../i18n';
import AvatarFace from './AvatarFace';
import JoinServerModal from './JoinServerModal';
import CreateServerModal from './CreateServerModal';
import ServerAddMenu from './ServerAddMenu';
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
  const t = useT();
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServerId = useServerStore((s) => s.setActiveServerId);
  const unreadServerIds = useServerStore((s) => s.unreadServerIds);
  // Unread direct messages across every DM room — the Home button's badge.
  const unreadDmTotal = useDMStore((s) =>
    Object.values(s.unreadCounts).reduce((sum, count) => sum + count, 0),
  );

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const homeButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <aside className="server-sidebar">
      <div className="server-sidebar-logo" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="11" stroke="currentColor" strokeWidth="3" />
          <circle cx="14" cy="14" r="4" fill="currentColor" />
        </svg>
      </div>

      <button
        ref={homeButtonRef}
        className={`server-icon home-icon${activeServerId === null && !friendsActive ? ' active' : ''}`}
        onClick={() => {
          onNavigate();
          setActiveServerId(null);
        }}
        title={t('Direkt Mesajlar')}
        aria-label={
          unreadDmTotal > 0
            ? t('Direkt Mesajlar: {count} okunmamış mesaj', { count: unreadDmTotal })
            : t('Direkt Mesajlar')
        }
      >
        <Home size={20} strokeWidth={1.75} />
        {unreadDmTotal > 0 && (
          <span className="server-count-badge" aria-hidden="true">
            {unreadDmTotal > 9 ? '9+' : unreadDmTotal}
          </span>
        )}
      </button>

      <button
        className={`server-icon home-icon${friendsActive ? ' active' : ''}`}
        onClick={onSelectFriends}
        title={t('Arkadaşlar')}
        aria-label={t('Arkadaşlar')}
      >
        <Users size={20} strokeWidth={1.75} />
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
            <AvatarFace url={server.icon_url} fallback={serverInitials(server.name)} />
            {unreadServerIds.has(server.id) && <span className="server-unread-badge" />}
          </button>
        ))}
      </div>

      <div className="server-create-area">
        <ServerAddMenu
          onCreateServer={() => setShowCreateModal(true)}
          onJoinServer={() => setShowJoinModal(true)}
        />
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
