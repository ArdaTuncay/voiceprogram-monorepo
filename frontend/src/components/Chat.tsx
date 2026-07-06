import { useState, useEffect, useRef } from 'react';
import type { KeyboardEvent, ChangeEvent, DragEvent } from 'react';
import type {
  User,
  ChatMessage,
  PresenceUser,
  Channel,
  Server,
  NewMessageNotification,
  TypingNotification,
} from '../types';
import { fetchServers, createServer, fetchServerChannels, acceptInvite, uploadFile } from '../services/api';
import { resolveFileUrl } from '../config';
import {
  joinChatChannel,
  joinUserChannel,
  shout,
  sendTyping,
  disconnectSocket,
} from '../services/socket';
import { useVoiceChannel } from '../hooks/useVoiceChannel';
import ServerSidebar from './ServerSidebar';
import InviteModal from './InviteModal';
import ServerSettingsModal from './ServerSettingsModal';
import './Chat.css';

interface Props {
  user: User;
  onLogout: () => void;
}

/** Deterministic color per user from a small Discord-like palette. */
function userColor(userId: string): string {
  const palette = [
    '#7289da', '#43b581', '#faa61a', '#f04747',
    '#1abc9c', '#e91e63', '#9b59b6', '#e67e22',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

function formatTime(raw: string): string {
  // Elixir sends UTC without "Z"; append it so Date parses correctly.
  const d = new Date(raw.includes('Z') ? raw : raw + 'Z');
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function initials(name: string | null): string {
  if (!name) return '?';
  return name.slice(0, 2).toUpperCase();
}

// How long to wait after the last keystroke before telling the channel the
// user stopped typing.
const TYPING_STOP_DELAY_MS = 2000;

function typingIndicatorText(usernames: (string | null)[]): string {
  const names = usernames.map((name) => name || 'Bilinmeyen');
  if (names.length <= 2) return `${names.join(', ')} yazıyor...`;
  return `${names.slice(0, 2).join(', ')} ve ${names.length - 2} kişi daha yazıyor...`;
}

export default function Chat({ user, onLogout }: Props) {
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [channelError, setChannelError] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [unreadChannelIds, setUnreadChannelIds] = useState<Set<string>>(new Set());
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, string | null>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceChannel(user);

  // Tracks the local "am I currently flagged as typing" state so we only
  // push a "true" once per burst of keystrokes, plus the pending timer that
  // fires "false" after a pause.
  const isTypingRef = useRef(false);
  const typingStopTimerRef = useRef<number | null>(null);

  function clearTypingTimer() {
    if (typingStopTimerRef.current !== null) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
  }

  function stopTypingNow() {
    clearTypingTimer();
    if (isTypingRef.current) {
      isTypingRef.current = false;
      sendTyping(false);
    }
  }

  // Kept fresh every render so the long-lived notification subscription
  // below (which only runs once) never reads stale state.
  const activeChannelIdRef = useRef(activeChannelId);
  activeChannelIdRef.current = activeChannelId;

  // Same reasoning: the personal-notification effect below only runs once,
  // so "channel_deleted" needs a fresh read of the channel list to compute
  // which channel to fall back to.
  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  // Set by a notification click when it targets a channel in a different
  // server: tells the channel-fetch effect below to select that channel
  // instead of defaulting to the new server's first text channel.
  const pendingChannelIdRef = useRef<string | null>(null);

  // Fetch the servers the user belongs to and default to the first one.
  useEffect(() => {
    fetchServers().then(({ data, error }) => {
      if (error) {
        setChannelError(error);
        return;
      }
      setServers(data ?? []);
      setActiveServerId((current) => current ?? data?.[0]?.id ?? null);
    });
  }, []);

  // Fetch the active server's channels; switches straight to its first text
  // channel, mirroring how switching text channels already behaves.
  useEffect(() => {
    if (!activeServerId) {
      setChannels([]);
      setActiveChannelId(null);
      return;
    }

    fetchServerChannels(activeServerId).then(({ data, error }) => {
      if (error || !data) {
        setChannelError(error ?? 'No channels available');
        return;
      }
      setChannels(data);

      const pendingChannelId = pendingChannelIdRef.current;
      pendingChannelIdRef.current = null;

      if (pendingChannelId && data.some((c) => c.id === pendingChannelId)) {
        setActiveChannelId(pendingChannelId);
      } else {
        setActiveChannelId(data.find((c) => c.type === 'text')?.id ?? null);
      }
    });
  }, [activeServerId]);

  // Join the active channel's socket topic; leaves the previous one and
  // re-joins automatically whenever the user switches channels.
  useEffect(() => {
    if (!activeChannelId) return;

    setMessages([]);
    setOnlineUsers([]);
    setTypingUsers({});
    clearTypingTimer();
    isTypingRef.current = false;

    const cleanup = joinChatChannel(activeChannelId, {
      onJoined: (resp) => {
        setMessages(resp.messages);
        setChannelError('');
      },
      onShout: (msg) => setMessages((prev) => [...prev, msg]),
      onError: (reason) => setChannelError(reason),
      onPresenceChange: (users) => {
        setOnlineUsers(users);
        const onlineIds = new Set(users.map((u) => u.user_id));
        setTypingUsers((prev) => {
          const next = Object.fromEntries(
            Object.entries(prev).filter(([id]) => onlineIds.has(id))
          );
          return Object.keys(next).length === Object.keys(prev).length ? prev : next;
        });
      },
      onTyping: (payload: TypingNotification) => {
        setTypingUsers((prev) => {
          const next = { ...prev };
          if (payload.is_typing) next[payload.user_id] = payload.username;
          else delete next[payload.user_id];
          return next;
        });
      },
    });
    return cleanup;
  }, [activeChannelId]);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Make sure the microphone and peer connections are released if this
  // component ever unmounts while a voice room is active.
  const voiceLeaveRef = useRef(voice.leave);
  voiceLeaveRef.current = voice.leave;
  useEffect(() => () => voiceLeaveRef.current(), []);

  useEffect(() => clearTypingTimer, []);

  // Ask for desktop notification permission once, up front.
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  // Joins the personal notification topic once for the whole session — it
  // carries messages for every channel across every server the user is in,
  // not just the one currently open, so desktop notifications and unread
  // badges work regardless of what's on screen.
  useEffect(() => {
    const cleanup = joinUserChannel(user.id, {
      onNewMessage: (payload: NewMessageNotification) => {
        if (payload.channel_id === activeChannelIdRef.current) return;

        setUnreadChannelIds((prev) => new Set(prev).add(payload.channel_id));

        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const notification = new Notification(
            `#${payload.channel_name} — ${payload.username ?? 'Bilinmeyen'}`,
            { body: payload.content, tag: payload.channel_id }
          );
          notification.onclick = () => {
            window.focus();
            handleNotificationNavigateRef.current(payload.server_id, payload.channel_id);
            notification.close();
          };
        }
      },
      onChannelDeleted: (payload) => {
        const stillPresent = channelsRef.current.some((c) => c.id === payload.channel_id);
        if (!stillPresent) return;

        const remaining = channelsRef.current.filter((c) => c.id !== payload.channel_id);
        setChannels(remaining);

        setUnreadChannelIds((prev) => {
          if (!prev.has(payload.channel_id)) return prev;
          const next = new Set(prev);
          next.delete(payload.channel_id);
          return next;
        });

        if (activeChannelIdRef.current === payload.channel_id) {
          setActiveChannelId(remaining.find((c) => c.type === 'text')?.id ?? null);
        }
      },
      onServerUpdated: (payload) => {
        setServers((prev) =>
          prev.map((s) => (s.id === payload.server_id ? { ...s, name: payload.name } : s))
        );
      },
      onServerDeleted: (payload) => {
        setServers((prev) => prev.filter((s) => s.id !== payload.server_id));
        setActiveServerId((prevId) => (prevId === payload.server_id ? null : prevId));
      },
      onMemberKicked: (payload) => {
        if (payload.user_id !== user.id) return;
        setServers((prev) => prev.filter((s) => s.id !== payload.server_id));
        setActiveServerId((prevId) => (prevId === payload.server_id ? null : prevId));
      },
    });
    return cleanup;
  }, [user.id]);

  // If the voice room the user is currently in gets removed from the active
  // server's channel list (deleted, or the server itself got deleted/left),
  // tear down the connection instead of leaving it silently dangling.
  useEffect(() => {
    if (voice.activeRoomId && !channels.some((c) => c.id === voice.activeRoomId)) {
      voiceLeaveRef.current();
    }
  }, [channels, voice.activeRoomId]);

  function handleLogout() {
    voice.leave();
    disconnectSocket();
    onLogout();
  }

  function handleSelectChannel(channelId: string) {
    setUnreadChannelIds((prev) => {
      if (!prev.has(channelId)) return prev;
      const next = new Set(prev);
      next.delete(channelId);
      return next;
    });
    setActiveChannelId(channelId);
  }

  function handleNotificationNavigate(serverId: string, channelId: string) {
    setUnreadChannelIds((prev) => {
      if (!prev.has(channelId)) return prev;
      const next = new Set(prev);
      next.delete(channelId);
      return next;
    });

    if (serverId === activeServerId) {
      setActiveChannelId(channelId);
    } else {
      pendingChannelIdRef.current = channelId;
      setActiveServerId(serverId);
    }
  }

  // Same ref-indirection pattern as voiceLeaveRef above: the notification
  // effect only runs once, so it must call through a ref to always reach
  // the latest closure (which sees the current activeServerId).
  const handleNotificationNavigateRef = useRef(handleNotificationNavigate);
  handleNotificationNavigateRef.current = handleNotificationNavigate;

  async function handleCreateServer(name: string): Promise<string | undefined> {
    const { data, error } = await createServer(name);
    if (error || !data) return error ?? 'Failed to create server';

    setServers((prev) => [...prev, data]);
    setActiveServerId(data.id);
    return undefined;
  }

  async function handleJoinServer(code: string): Promise<string | undefined> {
    const { data, error } = await acceptInvite(code);
    if (error || !data) return error ?? 'Failed to join server';

    const server = data;
    setServers((prev) => (prev.some((s) => s.id === server.id) ? prev : [...prev, server]));
    setActiveServerId(server.id);
    return undefined;
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

  function sendMessage() {
    const content = draft.trim();
    if (!content) return;
    stopTypingNow();
    shout(content);
    setDraft('');
  }

  async function handleFileSelected(file: File) {
    if (!activeChannelId || isUploading) return;

    setIsUploading(true);
    setUploadError('');
    const { data, error } = await uploadFile(file);
    setIsUploading(false);

    if (error || !data) {
      setUploadError(error ?? 'Yükleme başarısız oldu');
      return;
    }

    stopTypingNow();
    shout(draft.trim(), data.file_url, data.file_type);
    setDraft('');
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
    if (!isDraggingFile) setIsDraggingFile(true);
  }

  function handleDragLeave(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDraggingFile(false);
  }

  function handleDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFileSelected(file);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleDraftChange(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setDraft(value);

    if (!value.trim()) {
      stopTypingNow();
      return;
    }

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      sendTyping(true);
    }

    clearTypingTimer();
    typingStopTimerRef.current = window.setTimeout(stopTypingNow, TYPING_STOP_DELAY_MS);
  }

  const myColor = userColor(user.id);
  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');
  const activeServer = servers.find((s) => s.id === activeServerId);
  const activeServerName = activeServer?.name ?? '';
  const activeChannelName = textChannels.find((c) => c.id === activeChannelId)?.name ?? '';
  const isServerOwner = activeServer?.owner_id === user.id;

  return (
    <div className="chat-layout">
      <ServerSidebar
        servers={servers}
        activeServerId={activeServerId}
        onSelect={setActiveServerId}
        onCreate={handleCreateServer}
        onJoin={handleJoinServer}
      />

      {/* ── Left sidebar ── */}
      <aside className="channel-sidebar">
        <div className="server-header">
          <span className="server-header-name">{activeServerName || 'VoiceProgram'}</span>
          {activeServerId && (
            <button
              className="invite-people-btn"
              onClick={() => setShowInviteModal(true)}
              title="İnsanları Davet Et"
              aria-label="İnsanları Davet Et"
            >
              👤+
            </button>
          )}
          {isServerOwner && (
            <button
              className="invite-people-btn"
              onClick={() => setShowSettingsModal(true)}
              title="Sunucu Ayarları"
              aria-label="Sunucu Ayarları"
            >
              ⚙️
            </button>
          )}
        </div>

        <nav className="channel-list">
          <div className="channel-category-label">Text Channels</div>
          {textChannels.map((ch) => {
            const unread = unreadChannelIds.has(ch.id);
            return (
              <div
                key={ch.id}
                className={`channel-item${ch.id === activeChannelId ? ' active' : ''}`}
                onClick={() => handleSelectChannel(ch.id)}
              >
                <span className="channel-hash">#</span>
                <span className={unread ? 'channel-name-unread' : undefined}>{ch.name}</span>
                {unread && <span className="unread-dot" />}
              </div>
            );
          })}

          <div className="channel-category-label">Voice Channels</div>
          {voiceChannels.map((room) => {
            const isActive = voice.activeRoomId === room.id;
            return (
              <div key={room.id}>
                <div
                  className={`channel-item voice-channel-item${isActive ? ' active' : ''}`}
                  onClick={() => handleVoiceRoomClick(room.id)}
                >
                  <span className="channel-hash">🔊</span>
                  {room.name}
                </div>

                {isActive && (
                  <div className="voice-participant-list">
                    {voice.participants.map((p) => {
                      const color = userColor(p.user_id);
                      const name = p.username ?? 'Unknown';
                      const speaking = voice.speakingUserIds.has(p.user_id);
                      const statusText = p.deafened
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
                                  🔇
                                </span>
                              )}
                              {p.deafened && (
                                <span className="voice-status-icon deafen-icon" title="Sağırlaştırıldı">
                                  🔕
                                </span>
                              )}
                            </span>
                            <span className="voice-participant-status">{statusText}</span>
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
                        {voice.isMuted ? '🔇' : '🎤'}
                      </button>
                      <button
                        className={`voice-control-btn${voice.isDeafened ? ' active' : ''}`}
                        onClick={voice.toggleDeafen}
                        title={voice.isDeafened ? 'Sağırlaştırmayı Kaldır' : 'Sağırlaştır'}
                        aria-label={voice.isDeafened ? 'Sağırlaştırmayı Kaldır' : 'Sağırlaştır'}
                      >
                        {voice.isDeafened ? '🔕' : '🎧'}
                      </button>
                    </div>

                    <button
                      className={`screen-share-btn${voice.isScreenSharing ? ' active' : ''}`}
                      onClick={handleToggleScreenShare}
                    >
                      🖥️ {voice.isScreenSharing ? 'Ekranı Durdur' : 'Ekranı Paylaş'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {voice.error && <div className="channel-status error">⚠ {voice.error}</div>}
        </nav>

        <div className="user-panel">
          <div
            className="user-avatar-sm"
            style={{ background: myColor }}
            title={user.username}
          >
            {initials(user.username)}
          </div>
          <div className="user-info">
            <div className="user-name-sm">{user.username}</div>
            <div className="user-status-sm">● Online</div>
          </div>
          <button
            className="logout-btn"
            onClick={handleLogout}
            title="Log out"
            aria-label="Log out"
          >
            ↪
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <main
        className="chat-main"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <header className="chat-header">
          <span className="chat-header-hash">#</span>
          <span className="chat-header-name">{activeChannelName}</span>
        </header>

        {isDraggingFile && (
          <div className="drag-drop-overlay">
            <div className="drag-drop-message">📎 Fotoğrafı buraya bırak</div>
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

        <div className="messages-wrapper">
          <div className="messages-list">
            <div className="channel-intro">
              <h2># {activeChannelName}</h2>
              <p>Bu, #{activeChannelName} kanalının başlangıcı. Merhaba de!</p>
            </div>

            {messages.map((msg) => {
              const color = userColor(msg.user_id);
              const name = msg.username ?? 'Unknown';
              return (
                <div key={msg.id} className="message">
                  <div
                    className="message-avatar"
                    style={{ background: color }}
                    title={name}
                  >
                    {initials(name)}
                  </div>
                  <div className="message-body">
                    <div className="message-header">
                      <span className="message-author" style={{ color }}>
                        {name}
                      </span>
                      <span className="message-timestamp">
                        {formatTime(msg.inserted_at)}
                      </span>
                    </div>
                    {msg.content && <div className="message-content">{msg.content}</div>}
                    {msg.file_url && msg.file_type?.startsWith('image/') && (
                      <img
                        src={resolveFileUrl(msg.file_url)}
                        alt="ek"
                        className="message-attachment-image"
                        onClick={() => setLightboxUrl(msg.file_url)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>

        {channelError && (
          <div className="channel-status error">⚠ {channelError}</div>
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
              📎
            </button>
            <input
              className="message-input"
              type="text"
              placeholder={`Message #${activeChannelName}`}
              value={draft}
              onChange={handleDraftChange}
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
              ➤
            </button>
          </div>

          {isUploading && <div className="upload-status">Yükleniyor…</div>}
          {uploadError && <div className="upload-status upload-status-error">⚠ {uploadError}</div>}

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

      {lightboxUrl && (
        <div className="image-lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={resolveFileUrl(lightboxUrl)} alt="ek büyük önizleme" className="image-lightbox-img" />
        </div>
      )}

      {/* ── Right sidebar: online users ── */}
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
        <InviteModal serverId={activeServerId} onClose={() => setShowInviteModal(false)} />
      )}

      {showSettingsModal && activeServer && isServerOwner && (
        <ServerSettingsModal
          server={activeServer}
          channels={channels}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}
