import { useState, useEffect } from 'react';
import type { Channel, Server, ServerMember } from '../types';
import {
  updateServer,
  deleteServer,
  deleteChannel,
  kickMember,
  fetchServerMembers,
} from '../services/api';
import Modal from './Modal';
import './ServerSettingsModal.css';

type Tab = 'general' | 'channels' | 'members';

interface Props {
  server: Server;
  channels: Channel[];
  onClose: () => void;
}

export default function ServerSettingsModal({ server, channels, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('general');

  return (
    <Modal title={`Sunucu Ayarları — ${server.name}`} onClose={onClose}>
      <div className="settings-tabs">
        <button
          className={`settings-tab${tab === 'general' ? ' active' : ''}`}
          onClick={() => setTab('general')}
        >
          Genel Ayarlar
        </button>
        <button
          className={`settings-tab${tab === 'channels' ? ' active' : ''}`}
          onClick={() => setTab('channels')}
        >
          Kanalları Yönet
        </button>
        <button
          className={`settings-tab${tab === 'members' ? ' active' : ''}`}
          onClick={() => setTab('members')}
        >
          Üyeler
        </button>
      </div>

      {tab === 'general' && <GeneralTab server={server} onClose={onClose} />}
      {tab === 'channels' && <ChannelsTab channels={channels} />}
      {tab === 'members' && <MembersTab serverId={server.id} ownerId={server.owner_id} />}
    </Modal>
  );
}

function GeneralTab({ server, onClose }: { server: Server; onClose: () => void }) {
  const [name, setName] = useState(server.name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(server.name);
  }, [server.name]);

  const trimmedName = name.trim();

  async function handleSave() {
    if (!trimmedName || trimmedName === server.name) return;

    setSaving(true);
    setError('');
    const { error } = await updateServer(server.id, trimmedName);
    setSaving(false);

    if (error) {
      setError(error);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleDelete() {
    setDeleting(true);
    setError('');
    const { error } = await deleteServer(server.id);
    setDeleting(false);

    if (error) {
      setError(error);
      return;
    }
    onClose();
  }

  return (
    <div className="settings-section">
      <label className="settings-label" htmlFor="server-name-input">
        Sunucu Adı
      </label>
      <div className="settings-row">
        <input
          id="server-name-input"
          className="settings-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          disabled={saving}
        />
        <button
          className="settings-save-btn"
          onClick={handleSave}
          disabled={saving || !trimmedName || trimmedName === server.name}
        >
          {saved ? 'Kaydedildi!' : 'Kaydet'}
        </button>
      </div>

      {error && <div className="settings-error">⚠ {error}</div>}

      <div className="settings-danger-zone">
        <h4 className="settings-danger-title">Tehlikeli Bölge</h4>
        <p className="settings-danger-description">
          Sunucuyu silmek geri alınamaz; tüm kanallar, mesajlar ve üyelikler kalıcı olarak
          silinir.
        </p>
        {confirmingDelete ? (
          <div className="settings-row">
            <button
              className="settings-confirm-delete-btn"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Siliniyor…' : 'Evet, Sunucuyu Sil'}
            </button>
            <button
              className="settings-cancel-btn"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
            >
              Vazgeç
            </button>
          </div>
        ) : (
          <button className="settings-delete-btn" onClick={() => setConfirmingDelete(true)}>
            Sunucuyu Sil
          </button>
        )}
      </div>
    </div>
  );
}

function ChannelsTab({ channels }: { channels: Channel[] }) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function handleDelete(channelId: string) {
    setDeletingId(channelId);
    setError('');
    const { error } = await deleteChannel(channelId);
    setDeletingId(null);
    if (error) setError(error);
    // On success the channel disappears once the "channel_deleted" broadcast
    // updates Chat.tsx's channel list, which flows back into this list.
  }

  return (
    <div className="settings-section">
      {error && <div className="settings-error">⚠ {error}</div>}
      <ul className="settings-list">
        {channels.map((channel) => (
          <li key={channel.id} className="settings-list-item">
            <span>
              {channel.type === 'voice' ? '🔊' : '#'} {channel.name}
            </span>
            <button
              className="settings-icon-btn"
              onClick={() => handleDelete(channel.id)}
              disabled={deletingId === channel.id}
              title="Kanalı Sil"
              aria-label={`${channel.name} kanalını sil`}
            >
              🗑️
            </button>
          </li>
        ))}
        {channels.length === 0 && <li className="settings-empty">Henüz kanal yok.</li>}
      </ul>
    </div>
  );
}

function MembersTab({ serverId, ownerId }: { serverId: string; ownerId: string }) {
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kickingId, setKickingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchServerMembers(serverId).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setError(error ?? 'Üye listesi alınamadı');
      } else {
        setMembers(data);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  async function handleKick(userId: string) {
    setKickingId(userId);
    setError('');
    const { error } = await kickMember(serverId, userId);
    setKickingId(null);

    if (error) {
      setError(error);
      return;
    }
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  }

  if (loading) {
    return <div className="settings-section">Yükleniyor…</div>;
  }

  return (
    <div className="settings-section">
      {error && <div className="settings-error">⚠ {error}</div>}
      <ul className="settings-list">
        {members.map((member) => (
          <li key={member.user_id} className="settings-list-item">
            <span>
              {member.username ?? 'Bilinmeyen'}
              {member.user_id === ownerId && <span className="settings-owner-badge">Sahip</span>}
            </span>
            {member.user_id !== ownerId && (
              <button
                className="settings-icon-btn"
                onClick={() => handleKick(member.user_id)}
                disabled={kickingId === member.user_id}
                title="Sunucudan At"
                aria-label={`${member.username ?? 'kullanıcıyı'} sunucudan at`}
              >
                🚫
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
