import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ChangeEvent, DragEvent, UIEvent } from 'react';
import type { User, Channel, ChannelType } from '../types';
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
import { userColor, initials } from '../utils';
import ServerSidebar from './ServerSidebar';
import InviteModal from './InviteModal';
import ServerSettingsModal from './ServerSettingsModal';
import CreateChannelModal from './CreateChannelModal';
import LeaveServerModal from './LeaveServerModal';
import FriendsPanel from './FriendsPanel';
import DMChatView from './DMChatView';
import MessageItem from './MessageItem';
import SearchBar from './SearchBar';
import SearchResultsPanel from './SearchResultsPanel';
import {
  Volume2,
  Mic,
  MicOff,
  Headphones,
  VolumeX,
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
  FolderPlus,
  RefreshCw,
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

export default function Chat({ user, onLogout }: Props) {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const channels = useServerStore((s) => s.channels);
  const activeChannelId = useServerStore((s) => s.activeChannelId);
  const unreadChannelIds = useServerStore((s) => s.unreadChannelIds);
  const channelError = useServerStore((s) => s.channelError);
  const selectChannel = useServerStore((s) => s.selectChannel);
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
  const unreadRoomIds = useDMStore((s) => s.unreadRoomIds);
  const loadDmRooms = useDMStore((s) => s.loadRooms);
  const setActiveDmRoomId = useDMStore((s) => s.setActiveRoomId);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
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
  useSocketSync(user.id);

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

  // Make sure the microphone and peer connections are released if this
  // component ever unmounts while a voice room is active.
  const voiceLeaveRef = useRef(voice.leave);
  voiceLeaveRef.current = voice.leave;
  useEffect(() => () => voiceLeaveRef.current(), []);

  // If the voice room the user is currently in gets removed from the active
  // server's channel list (deleted, or the server itself got deleted/left),
  // tear down the connection instead of leaving it silently dangling.
  useEffect(() => {
    if (voice.activeRoomId && !channels.some((c) => c.id === voice.activeRoomId)) {
      voiceLeaveRef.current();
    }
  }, [channels, voice.activeRoomId]);

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
    voice.leave();
    disconnectSocket();
    onLogout();
  }

  function handleVoiceRoomClick(roomId: string) {
    if (voice.activeRoomId === roomId) {
      voice.leave();
    } else {
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
              {voice.participants.map((p) => {
                const color = userColor(p.user_id);
                const name = p.username ?? 'Unknown';
                const speaking = voice.speakingUserIds.has(p.user_id);
                const reconnecting = voice.reconnectingPeerIds.has(p.user_id);
                const statusText = reconnecting
                  ? 'Yeniden Bağlanıyor...'
                  : p.deafened
                    ? 'Sağırlaştırıldı'
                    : p.muted
                      ? 'Mikrofon Kapalı'
                      : speaking
                        ? 'Konuşuyor'
                        : 'Ses Bağlantısı Aktif';
                return (
                  <div key={p.user_id} className="voice-participant">
                    <div
                      className={`voice-participant-avatar${speaking ? ' speaking' : ''}`}
                      style={{ background: color }}
                      title={name}
                    >
                      {initials(name)}
                    </div>
                    <div className="voice-participant-info">
                      <span className="voice-participant-name">
                        {name}
                        {p.muted && (
                          <span className="voice-status-icon mute-icon" title="Mikrofon Kapalı">
                            <MicOff size={10} />
                          </span>
                        )}
                        {p.deafened && (
                          <span className="voice-status-icon deafen-icon" title="Sağırlaştırıldı">
                            <VolumeX size={10} />
                          </span>
                        )}
                      </span>
                      <span className={`voice-participant-status${reconnecting ? ' reconnecting' : ''}`}>
                        {reconnecting && <RefreshCw size={10} />} {statusText}
                      </span>
                    </div>
                  </div>
                );
              })}

              <div className="voice-controls-row">
                <button
                  className={`voice-control-btn${voice.isMuted ? ' active' : ''}`}
                  onClick={voice.toggleMute}
                  title={voice.isMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}
                  aria-label={voice.isMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}
                >
                  {voice.isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
                <button
                  className={`voice-control-btn${voice.isDeafened ? ' active' : ''}`}
                  onClick={voice.toggleDeafen}
                  title={voice.isDeafened ? 'Sağırlaştırmayı Kaldır' : 'Sağırlaştır'}
                  aria-label={voice.isDeafened ? 'Sağırlaştırmayı Kaldır' : 'Sağırlaştır'}
                >
                  {voice.isDeafened ? <VolumeX size={16} /> : <Headphones size={16} />}
                </button>
              </div>

              <button
                className={`screen-share-btn${voice.isScreenSharing ? ' active' : ''}`}
                onClick={handleToggleScreenShare}
              >
                {voice.isScreenSharing ? <ScreenShareOff size={14} /> : <ScreenShare size={14} />}{' '}
                {voice.isScreenSharing ? 'Ekranı Durdur' : 'Ekranı Paylaş'}
              </button>
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

  return (
    <div className="chat-layout">
      {/* Only after we've actually been connected before — never during the
          initial page-load handshake, where this would be a misleading
          flash rather than a real "you got disconnected" signal. */}
      {!isConnected && hasConnectedBefore && (
        <div className="reconnect-banner" role="status">
          <span className="reconnect-banner-dot" />
          Yeniden bağlanmaya çalışılıyor...
        </div>
      )}

      <ServerSidebar />

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

            <nav className="channel-list">
              {isServerOwner && (
                <div className="channel-list-toolbar">
                  <button
                    className="channel-category-add-btn"
                    onClick={() => setCreateChannelRequest({ type: 'text', parentId: null })}
                    title="Metin Kanalı Oluştur"
                    aria-label="Metin Kanalı Oluştur"
                  >
                    <Hash size={14} />
                  </button>
                  <button
                    className="channel-category-add-btn"
                    onClick={() => setCreateChannelRequest({ type: 'voice', parentId: null })}
                    title="Ses Kanalı Oluştur"
                    aria-label="Ses Kanalı Oluştur"
                  >
                    <Volume2 size={14} />
                  </button>
                  <button
                    className="channel-category-add-btn"
                    onClick={() => setCreateChannelRequest({ type: 'category', parentId: null })}
                    title="Kategori Oluştur"
                    aria-label="Kategori Oluştur"
                  >
                    <FolderPlus size={14} />
                  </button>
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
                            <button
                              className="channel-category-add-btn"
                              onClick={() =>
                                setCreateChannelRequest({ type: 'text', parentId: group.category!.id })
                              }
                              title="Bu kategoriye metin kanalı ekle"
                              aria-label="Bu kategoriye metin kanalı ekle"
                            >
                              <Hash size={12} />
                            </button>
                            <button
                              className="channel-category-add-btn"
                              onClick={() =>
                                setCreateChannelRequest({ type: 'voice', parentId: group.category!.id })
                              }
                              title="Bu kategoriye ses kanalı ekle"
                              aria-label="Bu kategoriye ses kanalı ekle"
                            >
                              <Volume2 size={12} />
                            </button>
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

            <nav className="channel-list">
              {dmRooms.map((room) => {
                const unread = unreadRoomIds.has(room.id);
                const color = userColor(room.user_id);
                const name = room.username ?? 'Bilinmeyen';
                return (
                  <div
                    key={room.id}
                    className={`channel-item dm-room-item${room.id === activeDmRoomId ? ' active' : ''}`}
                    onClick={() => setActiveDmRoomId(room.id)}
                  >
                    <div className="dm-room-avatar-wrapper">
                      <div className="dm-room-avatar" style={{ background: color }} title={name}>
                        {initials(name)}
                      </div>
                      <span className={`dm-room-status-dot${room.user_status === 'online' ? ' online' : ''}`} />
                    </div>
                    <span className={unread ? 'channel-name-unread' : undefined}>{name}</span>
                    {unread && <span className="unread-dot" />}
                  </div>
                );
              })}
              {dmRooms.length === 0 && (
                <div className="channel-status">
                  Henüz bir sohbetin yok — Arkadaşlar panelinden birine mesaj gönder!
                </div>
              )}
            </nav>
          </>
        )}

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
            className="logout-btn"
            onClick={handleLogout}
            title="Log out"
            aria-label="Log out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* ── Main area — exactly one of the three renders at a time, each
          owning its own <main> (server chat keeps drag/drop bound to the
          channel store here; DMChatView binds its own to the DM store) ── */}
      {activeServerId ? (
        <>
        <main
          className="chat-main"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
            <header className="chat-header">
              <span className="chat-header-hash"><Hash size={20} /></span>
              <span className="chat-header-name">{activeChannelName}</span>
              {activeChannelId && (
                <SearchBar
                  isSearching={isSearching}
                  onSearch={(filters) => void searchChannelMessages(activeChannelId, filters)}
                />
              )}
            </header>

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
                          if (el) el.srcObject = stream;
                        }}
                      />
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

                {messages.map((msg) => (
                  <MessageItem
                    key={msg.id}
                    message={msg}
                    currentUserId={user.id}
                    onToggleReaction={(emoji) => toggleReaction(msg.id, emoji)}
                    onEditMessage={(content) => editMessage(msg.id, content)}
                    onImageClick={setLightboxUrl}
                    isHighlighted={msg.id === highlightedMessageId}
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
        </main>
        {isSearchPanelOpen && (
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
          <FriendsPanel />
        </main>
      )}

      {lightboxUrl && (
        <div className="image-lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={resolveFileUrl(lightboxUrl)} alt="ek büyük önizleme" className="image-lightbox-img" />
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
                    <span className="online-status-dot" />
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
            if (el) el.srcObject = stream;
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
    </div>
  );
}
