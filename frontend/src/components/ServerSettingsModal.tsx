import { useState, useEffect } from 'react';
import { AlertTriangle, Volume2, Hash, Trash2, UserX, Ban } from 'lucide-react';
import StatusIndicator from './StatusIndicator';
import type { Channel, Server, ServerMember, Invite } from '../types';
import type { ServerBan } from '../services/api';
import {
  updateServer,
  deleteServer,
  deleteChannel,
  kickMember,
  banMember,
  fetchServerBans,
  unbanMember,
  fetchServerMembers,
  fetchServerInvites,
  revokeInvite,
} from '../services/api';
import { useServerStore } from '../stores/useServerStore';
import Modal from './Modal';
import './ServerSettingsModal.css';

type Tab = 'general' | 'channels' | 'members' | 'bans' | 'invites';

interface Props {
  onClose: () => void;
}

export default function ServerSettingsModal({ onClose }: Props) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const servers = useServerStore((s) => s.servers);
  const channels = useServerStore((s) => s.channels);
  const server = servers.find((s) => s.id === activeServerId);
  const [tab, setTab] = useState<Tab>('general');

  if (!server) return null;

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
        <button
          className={`settings-tab${tab === 'bans' ? ' active' : ''}`}
          onClick={() => setTab('bans')}
        >
          Yasaklılar
        </button>
        <button
          className={`settings-tab${tab === 'invites' ? ' active' : ''}`}
          onClick={() => setTab('invites')}
        >
          Davet Linkleri
        </button>
      </div>

      {tab === 'general' && <GeneralTab server={server} onClose={onClose} />}
      {tab === 'channels' && <ChannelsTab channels={channels} />}
      {tab === 'members' && <MembersTab serverId={server.id} ownerId={server.owner_id} />}
      {tab === 'bans' && <BansTab serverId={server.id} />}
      {tab === 'invites' && <InvitesTab serverId={server.id} />}
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

      {error && <div className="settings-error"><AlertTriangle size={14} /> {error}</div>}

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
      {error && <div className="settings-error"><AlertTriangle size={14} /> {error}</div>}
      <ul className="settings-list">
        {channels.map((channel) => (
          <li key={channel.id} className="settings-list-item">
            <span>
              {channel.type === 'voice' ? <Volume2 size={14} /> : <Hash size={14} />} {channel.name}
            </span>
            <button
              className="settings-icon-btn"
              onClick={() => handleDelete(channel.id)}
              disabled={deletingId === channel.id}
              title="Kanalı Sil"
              aria-label={`${channel.name} kanalını sil`}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {channels.length === 0 && <li className="list-empty-hint">Henüz kanal yok.</li>}
      </ul>
    </div>
  );
}

function MembersTab({ serverId, ownerId }: { serverId: string; ownerId: string }) {
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kickingId, setKickingId] = useState<string | null>(null);
  // Banning is harder to undo than a kick (it also blocks rejoining), so
  // it takes a second, explicit confirmation with an optional reason.
  const [banTargetId, setBanTargetId] = useState<string | null>(null);
  const [banReason, setBanReason] = useState('');
  const [banning, setBanning] = useState(false);
  // Live updates (see BackendWeb.UserChannel's "member_status_changed") take
  // priority over whatever was last fetched — fetchServerMembers's `status`
  // is just the seed value until the first live update for that user arrives.
  const memberStatuses = useServerStore((s) => s.memberStatuses);

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

  async function handleBan(userId: string) {
    setBanning(true);
    setError('');
    const { error } = await banMember(serverId, userId, banReason.trim());
    setBanning(false);

    if (error) {
      setError(error);
      return;
    }
    setBanTargetId(null);
    setBanReason('');
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  }

  if (loading) {
    return <div className="settings-section">Yükleniyor…</div>;
  }

  return (
    <div className="settings-section">
      {error && <div className="settings-error"><AlertTriangle size={14} /> {error}</div>}
      <ul className="settings-list">
        {members.map((member) => {
          const status = memberStatuses[member.user_id] ?? member.status;
          return (
            <li key={member.user_id} className="settings-list-item">
              <span>
                <StatusIndicator
                  status={status === 'online' ? 'online' : 'offline'}
                  size={8}
                  className="member-status-dot"
                />
                {member.username ?? 'Bilinmeyen'}
                {member.user_id === ownerId && <span className="settings-owner-badge">Sahip</span>}
              </span>
              {member.user_id !== ownerId && (
                <span className="settings-member-actions">
                  <button
                    className="settings-icon-btn"
                    onClick={() => handleKick(member.user_id)}
                    disabled={kickingId === member.user_id}
                    title="Sunucudan At"
                    aria-label={`${member.username ?? 'kullanıcıyı'} sunucudan at`}
                  >
                    <UserX size={14} />
                  </button>
                  <button
                    className="settings-icon-btn"
                    onClick={() => {
                      setBanTargetId(member.user_id);
                      setBanReason('');
                    }}
                    title="Sunucudan Yasakla"
                    aria-label={`${member.username ?? 'kullanıcıyı'} sunucudan yasakla`}
                  >
                    <Ban size={14} />
                  </button>
                </span>
              )}
              {banTargetId === member.user_id && (
                <div className="settings-ban-confirm">
                  <input
                    className="settings-input"
                    placeholder="Sebep (isteğe bağlı)"
                    aria-label="Yasaklama sebebi"
                    value={banReason}
                    maxLength={200}
                    onChange={(e) => setBanReason(e.target.value)}
                  />
                  <button
                    className="settings-confirm-delete-btn"
                    onClick={() => handleBan(member.user_id)}
                    disabled={banning}
                  >
                    {banning ? 'Yasaklanıyor…' : 'Yasakla'}
                  </button>
                  <button className="settings-cancel-btn" onClick={() => setBanTargetId(null)}>
                    Vazgeç
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BansTab({ serverId }: { serverId: string }) {
  const [bans, setBans] = useState<ServerBan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liftingId, setLiftingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchServerBans(serverId).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) setError(error ?? 'Yasak listesi alınamadı');
      else setBans(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  async function handleUnban(userId: string) {
    setLiftingId(userId);
    setError('');
    const { error } = await unbanMember(serverId, userId);
    setLiftingId(null);
    if (error) {
      setError(error);
      return;
    }
    setBans((prev) => prev.filter((b) => b.user_id !== userId));
  }

  if (loading) {
    return <div className="settings-section">Yükleniyor…</div>;
  }

  return (
    <div className="settings-section">
      {error && <div className="settings-error"><AlertTriangle size={14} /> {error}</div>}
      <ul className="settings-list">
        {bans.map((ban) => (
          <li key={ban.user_id} className="settings-list-item">
            <span>
              {ban.username ?? 'Bilinmeyen'}
              {ban.reason && <span className="settings-ban-reason"> — {ban.reason}</span>}
            </span>
            <button
              className="settings-cancel-btn"
              onClick={() => handleUnban(ban.user_id)}
              disabled={liftingId === ban.user_id}
            >
              Yasağı kaldır
            </button>
          </li>
        ))}
        {bans.length === 0 && <li className="list-empty-hint">Yasaklı kullanıcı yok.</li>}
      </ul>
    </div>
  );
}

function formatExpiresAt(expiresAt: string | null): string {
  if (!expiresAt) return 'Süresiz';
  const date = new Date(expiresAt.includes('Z') ? expiresAt : expiresAt + 'Z');
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function isInviteExpired(invite: Invite): boolean {
  if (!invite.expires_at) return false;
  const expiresAt = new Date(invite.expires_at.includes('Z') ? invite.expires_at : invite.expires_at + 'Z');
  return expiresAt.getTime() <= Date.now();
}

function isInviteMaxedOut(invite: Invite): boolean {
  return invite.max_uses !== null && invite.uses_count >= invite.max_uses;
}

function InvitesTab({ serverId }: { serverId: string }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchServerInvites(serverId).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setError(error ?? 'Davet listesi alınamadı');
      } else {
        setInvites(data);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  async function handleRevoke(inviteId: string) {
    setRevokingId(inviteId);
    setError('');
    const { error } = await revokeInvite(serverId, inviteId);
    setRevokingId(null);

    if (error) {
      setError(error);
      return;
    }
    setInvites((prev) => prev.filter((i) => i.id !== inviteId));
  }

  if (loading) {
    return <div className="settings-section">Yükleniyor…</div>;
  }

  return (
    <div className="settings-section">
      {error && <div className="settings-error"><AlertTriangle size={14} /> {error}</div>}
      <ul className="settings-list">
        {invites.map((invite) => {
          const expired = isInviteExpired(invite);
          const maxedOut = isInviteMaxedOut(invite);
          const inactive = expired || maxedOut;
          return (
            <li key={invite.id} className="settings-list-item">
              <span>
                <code className={`invite-code${inactive ? ' invite-code-inactive' : ''}`}>
                  {invite.code}
                </code>
                <span className="invite-meta">
                  {expired
                    ? 'Süresi doldu'
                    : maxedOut
                      ? 'Kullanım limiti doldu'
                      : formatExpiresAt(invite.expires_at)}
                  {' · '}
                  {invite.uses_count}
                  {invite.max_uses !== null ? `/${invite.max_uses}` : ''} kullanım
                </span>
              </span>
              <button
                className="settings-icon-btn"
                onClick={() => handleRevoke(invite.id)}
                disabled={revokingId === invite.id}
                title="Daveti İptal Et"
                aria-label={`${invite.code} kodlu daveti iptal et`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          );
        })}
        {invites.length === 0 && <li className="list-empty-hint">Henüz davet linki yok.</li>}
      </ul>
    </div>
  );
}
