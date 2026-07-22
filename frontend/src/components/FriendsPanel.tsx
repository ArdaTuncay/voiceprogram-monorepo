import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, MessageCircle, Trash2, Check, X } from 'lucide-react';
import type { Friendship } from '../types';
import { useFriendStore } from '../stores/useFriendStore';
import { useDMStore } from '../stores/useDMStore';
import { userColor, initials } from '../utils';
import StatusIndicator from './StatusIndicator';
import './FriendsPanel.css';

type SubTab = 'online' | 'all' | 'pending' | 'add';

export default function FriendsPanel() {
  const friendships = useFriendStore((s) => s.friendships);
  const loading = useFriendStore((s) => s.loading);
  const error = useFriendStore((s) => s.error);
  const loadFriendships = useFriendStore((s) => s.loadFriendships);
  const acceptRequest = useFriendStore((s) => s.acceptRequest);
  const removeFriendship = useFriendStore((s) => s.removeFriendship);

  const openRoomWithUser = useDMStore((s) => s.openRoomWithUser);

  const [subTab, setSubTab] = useState<SubTab>('online');
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [messageError, setMessageError] = useState('');

  useEffect(() => {
    loadFriendships();
  }, [loadFriendships]);

  const accepted = friendships.filter((f) => f.status === 'accepted');
  const online = accepted.filter((f) => f.user_status === 'online');
  const incoming = friendships.filter((f) => f.status === 'pending' && f.direction === 'incoming');
  const outgoing = friendships.filter((f) => f.status === 'pending' && f.direction === 'outgoing');

  async function handleAccept(id: string) {
    setActioningId(id);
    await acceptRequest(id);
    setActioningId(null);
  }

  async function handleRemove(id: string) {
    setActioningId(id);
    await removeFriendship(id);
    setActioningId(null);
  }

  async function handleMessage(userId: string) {
    setMessageError('');
    const errorMessage = await openRoomWithUser(userId);
    if (errorMessage) setMessageError(errorMessage);
  }

  return (
    <div className="friends-panel">
      <div className="friends-subtabs">
        <button
          className={`friends-subtab${subTab === 'online' ? ' active' : ''}`}
          onClick={() => setSubTab('online')}
        >
          Çevrimiçi
        </button>
        <button
          className={`friends-subtab${subTab === 'all' ? ' active' : ''}`}
          onClick={() => setSubTab('all')}
        >
          Tümü
        </button>
        <button
          className={`friends-subtab${subTab === 'pending' ? ' active' : ''}`}
          onClick={() => setSubTab('pending')}
        >
          Bekleyen İstekler
          {incoming.length > 0 && <span className="friends-subtab-badge">{incoming.length}</span>}
        </button>
        <button
          className={`friends-subtab friends-subtab-add${subTab === 'add' ? ' active' : ''}`}
          onClick={() => setSubTab('add')}
        >
          Arkadaş Ekle
        </button>
      </div>

      <div className="friends-content">
        {error && <div className="friends-error"><AlertTriangle size={14} /> {error}</div>}
        {messageError && <div className="friends-error"><AlertTriangle size={14} /> {messageError}</div>}

        {loading ? (
          <div className="friends-loading">Yükleniyor…</div>
        ) : (
          <>
            {subTab === 'online' && (
              <FriendList
                friendships={online}
                emptyText="Şu anda çevrimiçi arkadaşın yok."
                actioningId={actioningId}
                onRemove={handleRemove}
                onMessage={handleMessage}
              />
            )}
            {subTab === 'all' && (
              <FriendList
                friendships={accepted}
                emptyText="Henüz hiç arkadaşın yok."
                actioningId={actioningId}
                onRemove={handleRemove}
                onMessage={handleMessage}
              />
            )}
            {subTab === 'pending' && (
              <PendingList
                incoming={incoming}
                outgoing={outgoing}
                actioningId={actioningId}
                onAccept={handleAccept}
                onRemove={handleRemove}
              />
            )}
            {subTab === 'add' && <AddFriendForm />}
          </>
        )}
      </div>
    </div>
  );
}

function FriendAvatar({ friendship }: { friendship: Friendship }) {
  const color = userColor(friendship.user_id);
  const name = friendship.username ?? 'Bilinmeyen';
  return (
    <div className="friends-list-avatar-wrapper">
      <div className="friends-list-avatar" style={{ background: color }} title={name}>
        {initials(name)}
      </div>
      <StatusIndicator
        status={friendship.user_status === 'online' ? 'online' : 'offline'}
        size={11}
        className="friends-status-dot"
      />
    </div>
  );
}

function FriendList({
  friendships,
  emptyText,
  actioningId,
  onRemove,
  onMessage,
}: {
  friendships: Friendship[];
  emptyText: string;
  actioningId: string | null;
  onRemove: (id: string) => void;
  onMessage: (userId: string) => void;
}) {
  if (friendships.length === 0) {
    return <div className="friends-empty">{emptyText}</div>;
  }

  return (
    <ul className="friends-list">
      {friendships.map((f) => (
        <li key={f.id} className="friends-list-item">
          <FriendAvatar friendship={f} />
          <div className="friends-list-info">
            <span className="friends-list-name">{f.username ?? 'Bilinmeyen'}</span>
            <span className="friends-list-status">
              {f.user_status === 'online' ? 'Çevrimiçi' : 'Çevrimdışı'}
            </span>
          </div>
          <button
            className="friends-message-btn"
            onClick={() => onMessage(f.user_id)}
            title="Mesaj Gönder"
            aria-label={`${f.username ?? 'kullanıcıya'} mesaj gönder`}
          >
            <MessageCircle size={16} />
          </button>
          <button
            className="friends-remove-btn"
            onClick={() => onRemove(f.id)}
            disabled={actioningId === f.id}
            title="Arkadaşlıktan Çıkar"
            aria-label={`${f.username ?? 'kullanıcıyı'} arkadaşlıktan çıkar`}
          >
            <Trash2 size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function PendingList({
  incoming,
  outgoing,
  actioningId,
  onAccept,
  onRemove,
}: {
  incoming: Friendship[];
  outgoing: Friendship[];
  actioningId: string | null;
  onAccept: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (incoming.length === 0 && outgoing.length === 0) {
    return <div className="friends-empty">Bekleyen bir istek yok.</div>;
  }

  return (
    <div>
      {incoming.length > 0 && (
        <>
          <h4 className="friends-section-title">Gelen İstekler — {incoming.length}</h4>
          <ul className="friends-list">
            {incoming.map((f) => (
              <li key={f.id} className="friends-list-item">
                <FriendAvatar friendship={f} />
                <div className="friends-list-info">
                  <span className="friends-list-name">{f.username ?? 'Bilinmeyen'}</span>
                </div>
                <button
                  className="friends-accept-btn"
                  onClick={() => onAccept(f.id)}
                  disabled={actioningId === f.id}
                  title="Kabul Et"
                  aria-label={`${f.username ?? 'kullanıcının'} isteğini kabul et`}
                >
                  <Check size={14} />
                </button>
                <button
                  className="friends-remove-btn"
                  onClick={() => onRemove(f.id)}
                  disabled={actioningId === f.id}
                  title="Reddet"
                  aria-label={`${f.username ?? 'kullanıcının'} isteğini reddet`}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {outgoing.length > 0 && (
        <>
          <h4 className="friends-section-title">Gönderilen İstekler — {outgoing.length}</h4>
          <ul className="friends-list">
            {outgoing.map((f) => (
              <li key={f.id} className="friends-list-item">
                <FriendAvatar friendship={f} />
                <div className="friends-list-info">
                  <span className="friends-list-name">{f.username ?? 'Bilinmeyen'}</span>
                  <span className="friends-list-status">Beklemede</span>
                </div>
                <button
                  className="friends-remove-btn"
                  onClick={() => onRemove(f.id)}
                  disabled={actioningId === f.id}
                  title="İsteği İptal Et"
                  aria-label={`${f.username ?? 'kullanıcıya'} gönderilen isteği iptal et`}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function AddFriendForm() {
  const sendRequest = useFriendStore((s) => s.sendRequest);
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError('');
    setSuccess('');
    const errorMessage = await sendRequest(trimmed);
    setSubmitting(false);

    if (errorMessage) {
      setError(errorMessage);
      return;
    }
    setSuccess(`${trimmed} adlı kullanıcıya arkadaşlık isteği gönderildi!`);
    setUsername('');
  }

  return (
    <div className="add-friend-form">
      <h3 className="add-friend-title">Arkadaş Ekle</h3>
      <p className="add-friend-description">
        Kullanıcı adını tam olarak girerek bir arkadaşlık isteği gönderebilirsin.
      </p>
      <form onSubmit={handleSubmit} className="add-friend-row">
        <input
          className="add-friend-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Kullanıcı adı"
          disabled={submitting}
        />
        <button className="add-friend-submit-btn" type="submit" disabled={submitting || !username.trim()}>
          {submitting ? 'Gönderiliyor…' : 'İstek Gönder'}
        </button>
      </form>
      {error && <div className="friends-error"><AlertTriangle size={14} /> {error}</div>}
      {success && <div className="add-friend-success"><Check size={14} /> {success}</div>}
    </div>
  );
}
