import { useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bell, LogOut, Search, Settings, UserRound } from 'lucide-react';
import type { User } from '../types';
import { userColor, initials } from '../utils';
import { useT } from '../i18n';
import AvatarFace from './AvatarFace';
import { TopBarSlotContext } from './topBarSlotContext';
import './TopBar.css';

/**
 * The top bar's left part belongs to whichever view is on screen: its title
 * and its own buttons (search, member list, block). Chat.tsx renders the
 * views it owns straight into TopBar's children; a view that keeps its own
 * header state (DMChatView) renders through <TopBarSlot>, which portals
 * into the same spot (see topBarSlotContext.ts).
 */
export function TopBarSlot({ children }: { children: ReactNode }) {
  const slot = useContext(TopBarSlotContext);
  if (slot === undefined) return <>{children}</>;
  if (slot === null) return null;
  return createPortal(children, slot);
}

/**
 * The search pill: reads "Ara" while closed, holds the SearchBar (passed as
 * children) while open. The magnifier is the same toggle in both states,
 * so it opens and closes exactly like the old header search button — the
 * view owns `open` and unmounts SearchBar on close, which resets its query.
 */
export function TopBarSearch({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className={`topbar-search${open ? ' open' : ''}`}>
      <button
        type="button"
        className="topbar-search-toggle"
        onClick={onToggle}
        title={t('Mesajlarda ara')}
        aria-label={t('Mesajlarda ara')}
        aria-pressed={open}
      >
        <Search size={18} strokeWidth={1.75} />
        {!open && <span>{t('Ara')}</span>}
      </button>
      {open && children}
    </div>
  );
}

interface Props {
  user: User;
  /** Socket state — drives the avatar's status dot and the menu's status line. */
  isConnected: boolean;
  /** Incoming friend requests waiting for an answer — the bell's badge. */
  pendingRequestCount: number;
  onOpenPendingRequests: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  /** Receives the element views portal into (see TopBarSlot). */
  slotRef: (el: HTMLDivElement | null) => void;
  /** The current view's title and buttons, when Chat.tsx renders them itself. */
  children?: ReactNode;
}

export default function TopBar({
  user,
  isConnected,
  pendingRequestCount,
  onOpenPendingRequests,
  onOpenSettings,
  onLogout,
  slotRef,
  children,
}: Props) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // Same close rules as the app's other menus (ServerAddMenu,
  // MessageContextMenu): a click outside or ESC. ESC also hands focus back
  // to the avatar so keyboard users don't lose their place.
  useEffect(() => {
    if (!menuOpen) return;
    firstItemRef.current?.focus();
    function handleClickOutside(e: MouseEvent) {
      if (menuRootRef.current && !menuRootRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
        return;
      }
      // Menu keyboard pattern: arrows move between items, Home/End jump.
      const items = Array.from(
        menuRootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      let next = -1;
      if (e.key === 'ArrowDown') next = (current + 1) % items.length;
      else if (e.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      if (next >= 0) {
        e.preventDefault();
        items[next].focus();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const statusText = isConnected ? t('Çevrimiçi') : t('Bağlantı Kesildi');
  const avatar = (
    <span className="topbar-avatar" style={{ background: userColor(user.id) }}>
      <AvatarFace url={user.avatar_url} fallback={initials(user.username)} />
      <span className={`topbar-avatar-dot${isConnected ? '' : ' offline'}`} aria-hidden="true" />
    </span>
  );

  return (
    <header className="topbar">
      <div className="topbar-view" ref={slotRef}>
        {children}
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className="topbar-btn"
          onClick={onOpenPendingRequests}
          title={t('Bildirimler')}
          aria-label={
            pendingRequestCount > 0
              ? t('Bildirimler: {count} arkadaşlık isteği', { count: pendingRequestCount })
              : t('Bildirimler')
          }
        >
          <Bell size={20} strokeWidth={1.75} />
          {pendingRequestCount > 0 && (
            <span className="topbar-badge" aria-hidden="true">
              {pendingRequestCount > 9 ? '9+' : pendingRequestCount}
            </span>
          )}
        </button>

        <button
          type="button"
          className="topbar-btn"
          onClick={onOpenSettings}
          title={t('Kullanıcı Ayarları')}
          aria-label={t('Kullanıcı Ayarları')}
        >
          <Settings size={20} strokeWidth={1.75} />
        </button>

        <div className="topbar-profile" ref={menuRootRef}>
          <button
            ref={triggerRef}
            type="button"
            className="topbar-profile-btn"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('Profil menüsü')}
            title={user.username}
          >
            {avatar}
          </button>

          {menuOpen && (
            <div className="topbar-menu" role="menu" aria-label={t('Profil menüsü')}>
              <div className="topbar-menu-who">
                {avatar}
                <div className="topbar-menu-who-text">
                  <span className="topbar-menu-name">{user.username}</span>
                  <span className="topbar-menu-status">{statusText}</span>
                </div>
              </div>
              <button
                ref={firstItemRef}
                type="button"
                role="menuitem"
                className="topbar-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSettings();
                }}
              >
                <UserRound size={16} strokeWidth={1.75} />
                {t('Profil ve hesap')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="topbar-menu-item topbar-menu-item-danger"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
              >
                <LogOut size={16} strokeWidth={1.75} />
                {t('Çıkış yap')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
