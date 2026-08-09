import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ChangeEvent, DragEvent, UIEvent } from 'react';
import type { User, Channel, ChannelType, PresenceUser } from '../types';
import { resolveFileUrl } from '../config';
import { disconnectSocket } from '../services/socket';
import { useVoiceChannel } from '../hooks/useVoiceChannel';
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea';
import { useCollapsedCategories } from '../hooks/useCollapsedCategories';
import { useServerStore, groupChannelsByCategory } from '../stores/useServerStore';
import { useChatStore } from '../stores/useChatStore';
import { useDMStore } from '../stores/useDMStore';
import { useSocketSync } from '../stores/useSocketStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { userColor, initials, shouldGroupMessages } from '../utils';
import { getMediaPreferences, supportsOutputDeviceSelection } from '../services/mediaPreferences';
import ServerSidebar from './ServerSidebar';
import InviteModal from './InviteModal';
import ServerSettingsModal from './ServerSettingsModal';
import CreateChannelModal from './CreateChannelModal';
import LeaveServerModal from './LeaveServerModal';
import FriendsPanel from './FriendsPanel';
import EmptyState from './EmptyState';
import DMChatView from './DMChatView';
import MessageItem from './MessageItem';
import SearchBar from './SearchBar';
import SearchResultsPanel from './SearchResultsPanel';
import StatusIndicator from './StatusIndicator';
import ChannelAddMenu from './ChannelAddMenu';
import NotificationPermissionBanner from './NotificationPermissionBanner';
import UserSettingsModal from './UserSettingsModal';
import VoiceStatusBar from './VoiceStatusBar';
import VoiceOrbit from './VoiceOrbit';
import type { OrbitParticipant } from './VoiceOrbit';
import {
  Volume2,
  ScreenShare,
  ScreenShareOff,
  Hash,
  UserPlus,
  Settings,
  DoorOpen,
  LogOut,
  ChevronDown,
  AlertTriangle,
  Circle,
  Paperclip,
  Send,
  Search,
  Maximize2,
  X,
} from 'lucide-react';
import './Chat.css';

interface Props {
  user: User;
  onLogout: () => void;
}

function typingIndicatorText(usernames: (string | null)[]): string {
  const names = usernames.map((name) => name || 'Bilinmeyen');
  if (names.length <= 2) return `${names.join(', ')} yazıyor...`;
  return `${names.slice(0, 2).join(', ')} ve ${names.length - 2} kişi daha yazıyor...`;
}

function formatUnreadBadge(count: number): string {
  return count > 9 ? '9+' : String(count);
}

function buildOrbitParticipants(
  participants: PresenceUser[],
  speakingUserIds: Set<string>,
  reconnectingPeerIds: Set<string>,
  peerVolumes: Record<string, number>,
): OrbitParticipant[] {
  return participants.map((p) => {
    const speaking = speakingUserIds.has(p.user_id);
    const reconnecting = reconnectingPeerIds.has(p.user_id);
    const name = p.username ?? 'Unknown';
    const statusText = reconnecting
      ? 'Yeniden Bağlanıyor...'
      : p.deafened
        ? 'Sağırlaştırıldı'
        : p.muted
          ? 'Mikrofon Kapalı'
          : speaking
            ? 'Konuşuyor'
            : 'Ses Bağlantısı Aktif';
    return {
      id: p.user_id,
      displayName: name,
      initials: initials(name),
      avatarColor: userColor(p.user_id),
      isSpeaking: speaking,
      isMuted: !!p.muted,
      isDeafened: !!p.deafened,
      isReconnecting: reconnecting,
      statusText,
      volume: peerVolumes[p.user_id] ?? 1,
    };
  });
}

export default function Chat({ user, onLogout }: Props) {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const channels = useServerStore((s) => s.channels);
  const channelsServerId = useServerStore((s) => s.channelsServerId);
  const activeChannelId = useServerStore((s) => s.activeChannelId);
  const unreadChannelIds = useServerStore((s) => s.unreadChannelIds);
  const channelError = useServerStore((s) => s.channelError);
  const selectChannel = useServerStore((s) => s.selectChannel);
  const setActiveServerId = useServerStore((s) => s.setActiveServerId);
  const loadServers = useServerStore((s) => s.loadServers);

  const messages = useChatStore((s) => s.messages);
  const draft = useChatStore((s) => s.draft);
  const onlineUsers = useChatStore((s) => s.onlineUsers);
  const typingUsers = useChatStore((s) => s.typingUsers);
  const isUploading = useChatStore((s) => s.isUploading);
  const uploadError = useChatStore((s) => s.uploadError);
  const isDraggingFile = useChatStore((s) => s.isDraggingFile);
  const lightboxUrl = useChatStore((s) => s.lightboxUrl);
  const hasMoreMessages = useChatStore((s) => s.hasMoreMessages);
  const isLoadingOlderMessages = useChatStore((s) => s.isLoadingOlderMessages);
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages);
  const handleDraftChange = useChatStore((s) => s.handleDraftChange);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const handleFileSelected = useChatStore((s) => s.handleFileSelected);
  const setDraggingFile = useChatStore((s) => s.setDraggingFile);
  const setLightboxUrl = useChatStore((s) => s.setLightboxUrl);
  const toggleReaction = useChatStore((s) => s.toggleReaction);
  const editMessage = useChatStore((s) => s.editMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const searchResults = useChatStore((s) => s.searchResults);
  const isSearching = useChatStore((s) => s.isSearching);
  const isSearchPanelOpen = useChatStore((s) => s.isSearchPanelOpen);
  const highlightedMessageId = useChatStore((s) => s.highlightedMessageId);
  const searchChannelMessages = useChatStore((s) => s.searchChannelMessages);
  const closeSearchPanel = useChatStore((s) => s.closeSearchPanel);
  const jumpToMessage = useChatStore((s) => s.jumpToMessage);
  const clearHighlight = useChatStore((s) => s.clearHighlight);
  const isConnected = useConnectionStore((s) => s.isConnected);
  const hasConnectedBefore = useConnectionStore((s) => s.hasConnectedBefore);
  const reconnectedAt = useConnectionStore((s) => s.reconnectedAt);

  const dmRooms = useDMStore((s) => s.rooms);
  const activeDmRoomId = useDMStore((s) => s.activeRoomId);
  const unreadCounts = useDMStore((s) => s.unreadCounts);
  const loadDmRooms = useDMStore((s) => s.loadRooms);
  const setActiveDmRoomId = useDMStore((s) => s.setActiveRoomId);

  // Whether the standalone Arkadaşlar (Friends) view is open — its own
  // view, separate from the Home/DM screen's default empty state (see
  // ServerSidebar's dedicated Friends icon).
  const [friendsViewOpen, setFriendsViewOpen] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showUserSettingsModal, setShowUserSettingsModal] = useState(false);
  const [isSearchBarOpen, setIsSearchBarOpen] = useState(false);
  const [maximizedPeerId, setMaximizedPeerId] = useState<string | null>(null);
  // Which server/channel the active voice room belongs to — captured at the
  // moment it's joined (see handleVoiceRoomClick), not derivable later from
  // `channels` alone (that array gets replaced wholesale on every server
  // switch, and Channel itself doesn't even carry a server_id). Read by the
  // "did the channel disappear" safety effect below (only relevant while
  // actually looking at this same server) and by the persistent
  // VoiceStatusBar (needs the name to show while looking at anything else).
  const [voiceRoomServerId, setVoiceRoomServerId] = useState<string | null>(null);
  const [voiceRoomName, setVoiceRoomName] = useState<string | null>(null);
  const [createChannelRequest, setCreateChannelRequest] = useState<{
    type: ChannelType;
    parentId: string | null;
  } | null>(null);
  const { collapsedIds, toggleCategory } = useCollapsedCategories();
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesWrapperRef = useRef<HTMLDivElement>(null);
  // Set right before a loadOlderMessages() call, to the scroll container's
  // scrollHeight at that moment; the layout effect below uses it to keep the
  // same message in view once the older page is prepended, instead of
  // scrolling to the bottom (the normal new-message behavior).
  const prevScrollHeightRef = useRef<number | null>(null);
  const textareaRef = useAutoGrowTextarea(draft);
  const voice = useVoiceChannel(user);

  // Fetch the servers the user belongs to once, on mount.
  useEffect(() => {
    loadServers();
  }, [loadServers]);

  // Fetch the user's DM rooms once, on mount — kept loaded regardless of
  // whether the DM view is currently showing, so the room list (and its
  // unread badges) are ready the instant the user clicks the home button.
  useEffect(() => {
    loadDmRooms();
  }, [loadDmRooms]);

  // Owns every Phoenix-channel join/leave effect (text channel + personal
  // notification topic) — see stores/useSocketStore.ts.
  useSocketSync(user);

  // Auto-scroll to bottom when messages change — except right after
  // prepending an older page (loadOlderMessages), where we instead restore
  // the scroll position so the message the user was looking at stays put.
  useLayoutEffect(() => {
    const container = messagesWrapperRef.current;
    if (container && prevScrollHeightRef.current !== null) {
      container.scrollTop = container.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = null;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleMessagesScroll(e: UIEvent<HTMLDivElement>) {
    if (e.currentTarget.scrollTop > 100) return;
    if (!hasMoreMessages || isLoadingOlderMessages) return;
    prevScrollHeightRef.current = e.currentTarget.scrollHeight;
    void loadOlderMessages();
  }

  // Scrolls a search result's target message into view once jumpToMessage
  // has confirmed it's loaded, then clears the highlight after a brief
  // flash so it doesn't linger indefinitely.
  useEffect(() => {
    if (!highlightedMessageId) return;
    document.getElementById(`message-${highlightedMessageId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
    const timer = window.setTimeout(() => clearHighlight(), 2000);
    return () => window.clearTimeout(timer);
  }, [highlightedMessageId, clearHighlight]);

  // Closing the search input (below) unmounts SearchBar entirely rather than
  // just hiding it, which is also what resets its own internal query/filter
  // state for free — no key/reset-prop needed. Switching channels closes it
  // too, so a previous channel's open search doesn't carry over.
  useEffect(() => {
    setIsSearchBarOpen(false);
  }, [activeChannelId]);

  // If the maximized peer's screen share ends (they stopped sharing, or the
  // voice room was left) while the overlay is open, close it instead of
  // leaving it stuck showing a frozen/stale video element.
  useEffect(() => {
    if (maximizedPeerId && !(maximizedPeerId in voice.screenShares)) {
      setMaximizedPeerId(null);
    }
  }, [voice.screenShares, maximizedPeerId]);

  useEffect(() => {
    if (!maximizedPeerId) return;
    function handleEscape(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setMaximizedPeerId(null);
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [maximizedPeerId]);

  // Make sure the microphone and peer connections are released if this
  // component ever unmounts while a voice room is active. Wraps voice.leave()
  // with clearing voiceRoomServerId/voiceRoomName (rather than doing that
  // separately at each call site) so every non-"switching to a different
  // room" leave path — this unmount cleanup, the safety effect below, and
  // handleVoiceRoomClick's toggle-off click — stays in sync for free.
  // Deliberately NOT used by join()'s own internal leave-then-rejoin (e.g.
  // the reconnect effect further down calls voice.join() directly): that
  // path's activeRoomId dips to null and back within the same logical
  // "still in the same room" operation, and clearing here would wipe
  // voiceRoomServerId out from under it with nothing to ever restore it.
  const voiceLeaveRef = useRef<() => void>(() => {});
  voiceLeaveRef.current = () => {
    voice.leave();
    setVoiceRoomServerId(null);
    setVoiceRoomName(null);
  };
  useEffect(() => () => voiceLeaveRef.current(), []);

  // If the voice room the user is currently in gets removed from the active
  // server's channel list (deleted, or the server itself got deleted/left),
  // tear down the connection instead of leaving it silently dangling. Gated
  // on BOTH activeServerId === voiceRoomServerId (actually viewing the
  // room's own server — without this, `channels` getting replaced by a
  // DIFFERENT server's list on every server switch alone hung up the call)
  // AND channelsServerId === activeServerId (channels has actually finished
  // loading for the server we're now viewing). The second check matters on
  // its own too: switching back to the voice room's own server sets
  // activeServerId synchronously, but `channels` isn't touched at all until
  // loadChannelsForActiveServer()'s fetch resolves — during that window
  // `channels` is still the *previous* server's list (or `[]`), so without
  // this the room's own channel briefly, wrongly, looks "gone" and this
  // effect hung up the call before the real list ever arrived.
  useEffect(() => {
    if (
      voice.activeRoomId &&
      activeServerId === voiceRoomServerId &&
      channelsServerId === activeServerId &&
      !channels.some((c) => c.id === voice.activeRoomId)
    ) {
      voiceLeaveRef.current();
    }
  }, [channels, channelsServerId, voice.activeRoomId, activeServerId, voiceRoomServerId]);

  // If the Phoenix socket dropped and came back (a brief network blip, the
  // laptop sleeping, etc.) while we were in a voice room, rejoin it from
  // scratch. A plain channel rejoin (which happens automatically — see
  // useSocketSync) isn't enough here: services/socket.ts's joinVoiceChannel
  // hands back the room's peer list through a Promise that only ever
  // resolves once, so a second (rejoin) reply is silently dropped and we'd
  // never learn about peers who joined or left while we were disconnected.
  // voice.join() already starts by calling leave() and resets to a clean,
  // disconnected state if it fails (e.g. the mic permission needs
  // re-granting) — covering the "or reset" fallback for free. Reads
  // voice.join/activeRoomId through refs (updated every render) rather than
  // depending on them directly, so this only fires on an actual reconnect
  // and never on an unrelated render — same stale-closure-avoidance pattern
  // as voiceLeaveRef above.
  const voiceJoinRef = useRef(voice.join);
  voiceJoinRef.current = voice.join;
  const activeVoiceRoomIdRef = useRef(voice.activeRoomId);
  activeVoiceRoomIdRef.current = voice.activeRoomId;
  useEffect(() => {
    if (!reconnectedAt) return;
    const roomId = activeVoiceRoomIdRef.current;
    if (roomId) void voiceJoinRef.current(roomId);
  }, [reconnectedAt]);

  function handleLogout() {
    voiceLeaveRef.current();
    disconnectSocket();
    onLogout();
  }

  function handleSelectFriends() {
    setActiveServerId(null);
    // Opening Friends never opens a DM — it replaces whatever DM view was
    // showing, so any previously-active room stops counting as "currently
    // viewed" (see useServerStore's setActiveServerId, which handles this
    // same reset for the server-select case).
    useDMStore.getState().setActiveRoomId(null);
    setFriendsViewOpen(true);
  }

  function handleVoiceRoomClick(roomId: string) {
    if (voice.activeRoomId === roomId) {
      voiceLeaveRef.current();
    } else {
      // Captured now, synchronously, rather than after join() resolves —
      // nothing reads either value unless voice.activeRoomId is also
      // truthy (both the safety effect above and VoiceStatusBar's render
      // gate on it), so a join that ultimately fails just leaves harmless,
      // unused stale values here instead of needing its own cleanup path.
      setVoiceRoomServerId(activeServerId);
      setVoiceRoomName(channels.find((c) => c.id === roomId)?.name ?? null);
      void voice.join(roomId);
    }
  }

  function handleToggleScreenShare() {
    if (voice.isScreenSharing) {
      void voice.stopScreenShare();
    } else {
      void voice.startScreenShare();
    }
  }

  function handleAttachClick() {
    fileInputRef.current?.click();
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleFileSelected(file);
  }

  function handleDragOver(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    if (!isDraggingFile) setDraggingFile(true);
  }

  function handleDragLeave(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDraggingFile(false);
  }

  function handleDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFileSelected(file);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleDraftInputChange(e: ChangeEvent<HTMLTextAreaElement>) {
    handleDraftChange(e.target.value);
  }

  const myColor = userColor(user.id);
  const activeServer = servers.find((s) => s.id === activeServerId);
  const activeServerName = activeServer?.name ?? '';
  const activeChannelName = channels.find((c) => c.id === activeChannelId)?.name ?? '';
  const isServerOwner = activeServer?.owner_id === user.id;
  const channelGroups = groupChannelsByCategory(channels);
  const hasCategories = channelGroups.length > 1;
  // `servers` (unlike `channels`) holds every server the user belongs to,
  // not just the currently-viewed one's, so the voice room's server name
  // stays resolvable here no matter what's currently on screen — only the
  // channel's own name (voiceRoomName) needs to be captured separately at
  // join time (see handleVoiceRoomClick).
  const voiceRoomServerName = servers.find((s) => s.id === voiceRoomServerId)?.name ?? null;

  function renderChannelRow(ch: Channel) {
    if (ch.type === 'voice') {
      const isActive = voice.activeRoomId === ch.id;
      return (
        <div key={ch.id}>
          <div
            className={`channel-item voice-channel-item${isActive ? ' active' : ''}`}
            onClick={() => handleVoiceRoomClick(ch.id)}
          >
            <span className="channel-hash"><Volume2 size={18} /></span>
            {ch.name}
          </div>

          {isActive && (
            <div className="voice-participant-list">
              <VoiceOrbit
                participants={buildOrbitParticipants(
                  voice.participants,
                  voice.speakingUserIds,
                  voice.reconnectingPeerIds,
                  voice.peerVolumes,
                )}
                currentUserId={user.id}
                onVolumeChange={voice.setPeerVolume}
              />

              <VoiceStatusBar
                isMuted={voice.isMuted}
                isDeafened={voice.isDeafened}
                onToggleMute={voice.toggleMute}
                onToggleDeafen={voice.toggleDeafen}
                onLeave={() => voiceLeaveRef.current()}
              />

              <button
                className={`screen-share-btn${voice.isScreenSharing ? ' active' : ''}`}
                onClick={handleToggleScreenShare}
              >
                {voice.isScreenSharing ? <ScreenShareOff size={14} /> : <ScreenShare size={14} />}{' '}
                {voice.isScreenSharing ? 'Ekranı Durdur' : 'Ekranı Paylaş'}
              </button>
            </div>
          )}

          {/* Join-before-you-look-inside preview — who's already in this
              room, without joining it yourself first (see
              Backend.Chat.voice_occupants/1 + "voice_presence_updated").
              Hidden once isActive, since VoiceOrbit above already shows
              (a richer version of) the same "who's in here" information —
              this would just be a redundant second list underneath it. */}
          {!isActive && !!ch.voice_occupants?.length && (
            <div className="voice-occupants-preview">
              {ch.voice_occupants.map((occupant) => (
                <div key={occupant.user_id} className="voice-occupant-preview-item">
                  <div
                    className="voice-occupant-preview-avatar"
                    style={{ background: userColor(occupant.user_id) }}
                  >
                    {initials(occupant.username)}
                  </div>
                  <span className="voice-occupant-preview-name">{occupant.username}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    const unread = unreadChannelIds.has(ch.id);
    return (
      <div
        key={ch.id}
        className={`channel-item${ch.id === activeChannelId ? ' active' : ''}`}
        onClick={() => selectChannel(ch.id)}
      >
        <span className="channel-hash"><Hash size={18} /></span>
        <span className={unread ? 'channel-name-unread' : undefined}>{ch.name}</span>
        {unread && <span className="unread-dot" />}
      </div>
    );
  }

  const userPanel = (
    <div className="user-panel">
      <div
        className={`user-avatar-sm${voice.activeRoomId && voice.speakingUserIds.has(user.id) ? ' speaking' : ''}`}
        style={{ background: myColor }}
        title={user.username}
      >
        {initials(user.username)}
      </div>
      <div className="user-info">
        <div className="user-name-sm">{user.username}</div>
        <div className={`user-status-sm${isConnected ? '' : ' user-status-offline'}`}>
          <Circle size={8} fill="currentColor" stroke="none" /> {isConnected ? 'Çevrimiçi' : 'Bağlantı Kesildi'}
        </div>
      </div>
      <button
        className="user-settings-btn"
        onClick={() => setShowUserSettingsModal(true)}
        title="Kullanıcı Ayarları"
        aria-label="Kullanıcı Ayarları"
      >
        <Settings size={20} strokeWidth={2} />
      </button>
      <button
        className="logout-btn"
        onClick={handleLogout}
        title="Log out"
        aria-label="Log out"
      >
        <LogOut size={20} strokeWidth={2} />
      </button>
    </div>
  );

  return (
    <div className="chat-layout">
      <NotificationPermissionBanner />

      {/* Only after we've actually been connected before — never during the
          initial page-load handshake, where this would be a misleading
          flash rather than a real "you got disconnected" signal. */}
      {!isConnected && hasConnectedBefore && (
        <div className="reconnect-banner" role="status">
          <span className="reconnect-banner-dot" />
          Yeniden bağlanmaya çalışılıyor...
        </div>
      )}

      <ServerSidebar
        friendsActive={friendsViewOpen}
        onSelectFriends={handleSelectFriends}
        onNavigate={() => setFriendsViewOpen(false)}
      />

      {/* Always accessible while a voice room is active, regardless of
          which server/DM/Arkadaşlar view is currently on screen — see the
          "leave on server switch" bug this (and the safety-effect guard
          above) fixes. */}
      {voice.activeRoomId && (
        <VoiceStatusBar
          variant="fixed"
          roomName={voiceRoomName}
          serverName={voiceRoomServerName}
          isMuted={voice.isMuted}
          isDeafened={voice.isDeafened}
          onToggleMute={voice.toggleMute}
          onToggleDeafen={voice.toggleDeafen}
          onLeave={() => voiceLeaveRef.current()}
        />
      )}

      {/* ── Left sidebar ── */}
      <aside className="channel-sidebar">
        {activeServerId ? (
          <>
            <div className="server-header">
              <span className="server-header-name">{activeServerName}</span>
              <button
                className="invite-people-btn"
                onClick={() => setShowInviteModal(true)}
                title="İnsanları Davet Et"
                aria-label="İnsanları Davet Et"
              >
                <UserPlus size={16} />
              </button>
              {isServerOwner && (
                <button
                  className="invite-people-btn"
                  onClick={() => setShowSettingsModal(true)}
                  title="Sunucu Ayarları"
                  aria-label="Sunucu Ayarları"
                >
                  <Settings size={16} />
                </button>
              )}
              {!isServerOwner && (
                <button
                  className="invite-people-btn leave-server-btn"
                  onClick={() => setShowLeaveModal(true)}
                  title="Sunucudan Ayrıl"
                  aria-label="Sunucudan Ayrıl"
                >
                  <DoorOpen size={16} />
                </button>
              )}
            </div>

            {userPanel}

            <nav className="channel-list">
              {isServerOwner && (
                <div className="channel-list-toolbar">
                  <span className="channel-category-label">Kanallar</span>
                  <ChannelAddMenu
                    label="Kanal Oluştur"
                    onSelect={(type) => setCreateChannelRequest({ type, parentId: null })}
                  />
                </div>
              )}

              {channelGroups.map((group) => {
                const collapsed = group.category ? collapsedIds.has(group.category.id) : false;
                return (
                  <div key={group.category?.id ?? 'uncategorized'} className="channel-category-group">
                    {group.category ? (
                      <div className="channel-category-row">
                        <button
                          type="button"
                          className="channel-category-toggle"
                          onClick={() => toggleCategory(group.category!.id)}
                        >
                          <ChevronDown size={12} className={`category-chevron${collapsed ? ' collapsed' : ''}`} />
                          <span className="channel-category-label">{group.category.name}</span>
                        </button>
                        {isServerOwner && (
                          <div className="channel-category-add-actions">
                            <ChannelAddMenu
                              label="Bu kategoriye kanal ekle"
                              includeCategory={false}
                              onSelect={(type) =>
                                setCreateChannelRequest({ type, parentId: group.category!.id })
                              }
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      hasCategories &&
                      group.channels.length > 0 && (
                        <div className="channel-category-row">
                          <span className="channel-category-label channel-category-label-plain">Kategorisiz</span>
                        </div>
                      )
                    )}
                    {!collapsed && group.channels.map(renderChannelRow)}
                  </div>
                );
              })}
              {voice.error && <div className="channel-status error"><AlertTriangle size={14} /> {voice.error}</div>}
            </nav>
          </>
        ) : (
          <>
            <div className="server-header">
              <span className="server-header-name">Direkt Mesajlar</span>
            </div>

            {userPanel}

            <nav className="channel-list">
              {dmRooms.map((room) => {
                const unreadCount = unreadCounts[room.id] ?? 0;
                const color = userColor(room.user_id);
                const name = room.username ?? 'Bilinmeyen';
                return (
                  <div
                    key={room.id}
                    className={`channel-item dm-room-item${room.id === activeDmRoomId ? ' active' : ''}`}
                    onClick={() => {
                      setFriendsViewOpen(false);
                      setActiveDmRoomId(room.id);
                    }}
                  >
                    <div className="dm-room-avatar-wrapper">
                      <div className="dm-room-avatar" style={{ background: color }} title={name}>
                        {initials(name)}
                      </div>
                      <StatusIndicator
                        status={room.user_status === 'online' ? 'online' : 'offline'}
                        size={9}
                        className="dm-room-status-dot"
                      />
                    </div>
                    <span className={unreadCount > 0 ? 'channel-name-unread' : undefined}>{name}</span>
                    {unreadCount > 0 && (
                      <span className="unread-badge">{formatUnreadBadge(unreadCount)}</span>
                    )}
                  </div>
                );
              })}
              {dmRooms.length === 0 && (
                <div className="list-empty-hint">
                  Henüz bir sohbetin yok — Arkadaşlar panelinden birine mesaj gönder!
                </div>
              )}
            </nav>
          </>
        )}
      </aside>

      {/* ── Main area — exactly one view renders at a time, each owning
          its own <main> (server chat keeps drag/drop bound to the channel
          store here; DMChatView binds its own to the DM store). The
          Arkadaşlar view takes priority over everything else since it's
          reached by explicitly navigating away from whatever server/DM was
          open (see handleSelectFriends). ── */}
      {friendsViewOpen ? (
        <main className="chat-main">
          <FriendsPanel />
        </main>
      ) : activeServerId ? (
        <>
        <main
          className="chat-main"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {!activeChannelId ? (
            <EmptyState message="Sohbet etmeye başlamak için bir kanal seç" />
          ) : (
          <>
            <header className="chat-header">
              <span className="chat-header-hash"><Hash size={20} /></span>
              <span className="chat-header-name">{activeChannelName}</span>
              <button
                className={`chat-header-search-btn${isSearchBarOpen ? ' active' : ''}`}
                onClick={() => setIsSearchBarOpen((open) => !open)}
                title="Mesajlarda ara"
                aria-label="Mesajlarda ara"
                aria-pressed={isSearchBarOpen}
              >
                <Search size={18} />
              </button>
            </header>

            {isSearchBarOpen && (
              <div className="chat-search-row">
                <SearchBar
                  isSearching={isSearching}
                  onSearch={(filters) => void searchChannelMessages(activeChannelId, filters)}
                />
              </div>
            )}

            {isDraggingFile && (
              <div className="drag-drop-overlay">
                <div className="drag-drop-message"><Paperclip size={18} /> Fotoğrafı buraya bırak</div>
              </div>
            )}

            {Object.keys(voice.screenShares).length > 0 && (
              <div className="screen-share-panel">
                {Object.entries(voice.screenShares).map(([peerId, stream]) => {
                  const sharerName =
                    peerId === user.id
                      ? user.username
                      : voice.participants.find((p) => p.user_id === peerId)?.username ?? 'Unknown';
                  return (
                    <div key={peerId} className="screen-share-tile">
                      <video
                        autoPlay
                        playsInline
                        muted={peerId === user.id}
                        className="screen-share-video"
                        ref={(el) => {
                          // Only reassign srcObject when the stream actually
                          // changed — an inline ref callback like this one
                          // re-runs on every re-render (new function
                          // identity each time), so without this check the
                          // video would restart/flicker on every unrelated
                          // re-render even though it's the same stream.
                          if (el && el.srcObject !== stream) {
                            el.srcObject = stream;
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="screen-share-maximize-btn"
                        onClick={() => setMaximizedPeerId(peerId)}
                        title="Büyüt"
                        aria-label="Büyüt"
                      >
                        <Maximize2 size={14} />
                      </button>
                      <div className="screen-share-label">{sharerName}</div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="messages-wrapper" ref={messagesWrapperRef} onScroll={handleMessagesScroll}>
              <div className="messages-list">
                {isLoadingOlderMessages && (
                  <div className="channel-status">Eski mesajlar yükleniyor…</div>
                )}
                <div className="channel-intro">
                  <h2><Hash size={28} /> {activeChannelName}</h2>
                  <p>Bu, #{activeChannelName} kanalının başlangıcı. Merhaba de!</p>
                </div>

                {messages.map((msg, index) => (
                  <MessageItem
                    key={msg.id}
                    message={msg}
                    currentUserId={user.id}
                    onToggleReaction={(emoji) => toggleReaction(msg.id, emoji)}
                    onEditMessage={(content) => editMessage(msg.id, content)}
                    onDeleteMessage={() => deleteMessage(msg.id)}
                    onImageClick={setLightboxUrl}
                    isServerOwner={isServerOwner}
                    isHighlighted={msg.id === highlightedMessageId}
                    isGrouped={shouldGroupMessages(messages[index - 1], msg)}
                  />
                ))}
                <div ref={bottomRef} />
              </div>
            </div>

            {channelError && (
              <div className="channel-status error"><AlertTriangle size={14} /> {channelError}</div>
            )}

            <div className="message-input-area">
              <div className="message-input-box">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleFileInputChange}
                />
                <button
                  className="attach-btn"
                  onClick={handleAttachClick}
                  disabled={!activeChannelId || isUploading}
                  title="Dosya Ekle"
                  aria-label="Dosya Ekle"
                >
                  <Paperclip size={18} />
                </button>
                <textarea
                  ref={textareaRef}
                  className="message-input"
                  rows={1}
                  placeholder={`Message #${activeChannelName}`}
                  value={draft}
                  onChange={handleDraftInputChange}
                  onKeyDown={handleKeyDown}
                  maxLength={4000}
                  disabled={!activeChannelId}
                />
                <button
                  className="send-btn"
                  onClick={sendMessage}
                  disabled={!draft.trim() || !activeChannelId}
                  aria-label="Send message"
                  title="Send (Enter)"
                >
                  <Send size={18} />
                </button>
              </div>

              {isUploading && <div className="upload-status">Yükleniyor…</div>}
              {uploadError && <div className="upload-status upload-status-error"><AlertTriangle size={14} /> {uploadError}</div>}

              {Object.keys(typingUsers).length > 0 && (
                <div className="typing-indicator">
                  <span className="typing-dots">
                    <span />
                    <span />
                    <span />
                  </span>
                  {typingIndicatorText(Object.values(typingUsers))}
                </div>
              )}
            </div>
          </>
          )}
        </main>
        {isSearchPanelOpen && activeChannelId && (
          <SearchResultsPanel
            results={searchResults}
            isSearching={isSearching}
            onSelectMessage={(messageId) => void jumpToMessage(messageId)}
            onClose={closeSearchPanel}
          />
        )}
        </>
      ) : activeDmRoomId ? (
        <DMChatView currentUserId={user.id} />
      ) : (
        <main className="chat-main">
          <EmptyState message="Sohbet etmeye başlamak için bir kişi veya kanal seç" />
        </main>
      )}

      {lightboxUrl && (
        <div className="image-lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={resolveFileUrl(lightboxUrl)} alt="ek büyük önizleme" className="image-lightbox-img" />
        </div>
      )}

      {/* Screen-share "büyüt" overlay — layered on top of the small tiles in
          screen-share-panel (which stay as-is underneath), reusing the same
          MediaStream rather than requesting a new one. Closes via the X
          button, clicking the backdrop, or ESC (see the effect above); also
          auto-closes if the sharer's stream disappears from
          voice.screenShares (see the other effect above). */}
      {maximizedPeerId && voice.screenShares[maximizedPeerId] && (
        <div
          className="screen-share-maximize-overlay"
          onClick={() => setMaximizedPeerId(null)}
          role="presentation"
        >
          <div className="screen-share-maximize-box" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="screen-share-maximize-close-btn"
              onClick={() => setMaximizedPeerId(null)}
              title="Kapat"
              aria-label="Kapat"
            >
              <X size={20} />
            </button>
            <video
              autoPlay
              playsInline
              muted={maximizedPeerId === user.id}
              className="screen-share-maximize-video"
              ref={(el) => {
                if (el) el.srcObject = voice.screenShares[maximizedPeerId];
              }}
            />
            <div className="screen-share-maximize-label">
              {maximizedPeerId === user.id
                ? user.username
                : voice.participants.find((p) => p.user_id === maximizedPeerId)?.username ?? 'Unknown'}
            </div>
          </div>
        </div>
      )}

      {/* ── Right sidebar: online users — hidden entirely until a server is active ── */}
      {activeServerId && (
        <aside className="online-sidebar">
          <div className="online-sidebar-header">
            Çevrimiçi — {onlineUsers.length}
          </div>
          <div className="online-user-list">
            {onlineUsers.map((presenceUser) => {
              const color = userColor(presenceUser.user_id);
              const name = presenceUser.username ?? 'Unknown';
              return (
                <div key={presenceUser.user_id} className="online-user-item">
                  <div className="online-user-avatar-wrapper">
                    <div
                      className="online-user-avatar"
                      style={{ background: color }}
                      title={name}
                    >
                      {initials(name)}
                    </div>
                    <StatusIndicator status="online" size={11} className="online-status-dot" />
                  </div>
                  <span className="online-user-name">{name}</span>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Hidden elements that actually play the remote peers' voice audio. */}
      {Object.entries(voice.remoteStreams).map(([peerId, stream]) => (
        <audio
          key={peerId}
          autoPlay
          muted={voice.isDeafened}
          style={{ display: 'none' }}
          ref={(el) => {
            if (!el) return;
            el.srcObject = stream;
            // Per-peer playback volume (see VoiceOrbit's popover, which
            // calls voice.setPeerVolume) — defaults to full volume when
            // this peer has no saved preference.
            el.volume = voice.peerVolumes[peerId] ?? 1;
            // Applies the saved output-device preference (see
            // UserSettingsModal's Ses & Görüntü tab) — a no-op string
            // ("") means "system default", and setSinkId isn't available
            // at all in every browser (Firefox), hence the guards.
            const { speakerDeviceId } = getMediaPreferences();
            if (speakerDeviceId && supportsOutputDeviceSelection()) {
              void el.setSinkId(speakerDeviceId).catch(() => {});
            }
          }}
        />
      ))}

      {showInviteModal && activeServerId && (
        <InviteModal onClose={() => setShowInviteModal(false)} />
      )}

      {showSettingsModal && isServerOwner && (
        <ServerSettingsModal onClose={() => setShowSettingsModal(false)} />
      )}

      {createChannelRequest && isServerOwner && (
        <CreateChannelModal
          type={createChannelRequest.type}
          parentId={createChannelRequest.parentId}
          onClose={() => setCreateChannelRequest(null)}
        />
      )}

      {showLeaveModal && activeServerId && !isServerOwner && (
        <LeaveServerModal onClose={() => setShowLeaveModal(false)} />
      )}

      {showUserSettingsModal && (
        <UserSettingsModal user={user} onClose={() => setShowUserSettingsModal(false)} />
      )}
    </div>
  );
}
