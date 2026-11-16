import { useState, useEffect } from 'react';
import { AlertTriangle, Volume2, Hash, Trash2, UserX, Ban, Shield, ShieldOff } from 'lucide-react';
import StatusIndicator from './StatusIndicator';
import type { Channel, MemberRole, Server, ServerMember, ServerReport, Invite } from '../types';
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
  setMemberRole,
  updateServerIcon,
  fetchServerReports,
  reviewReport,
} from '../services/api';
import { reportReasonLabel } from '../utils/reports';
import { currentLocale, t, useT } from '../i18n';
import { serverInitials } from '../utils';
import ImagePicker from './ImagePicker';
import { canModerate } from '../utils/permissions';
import { useServerStore } from '../stores/useServerStore';
import Modal from './Modal';
import './ServerSettingsModal.css';

type Tab = 'general' | 'channels' | 'members' | 'bans' | 'reports' | 'invites';

interface Props {
  onClose: () => void;
}

export default function ServerSettingsModal({ onClose }: Props) {
  // Subscribes to the UI language; the tabs below use the plain t() and
  // re-render along with this one.
  useT();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const servers = useServerStore((s) => s.servers);
  const channels = useServerStore((s) => s.channels);
  const server = servers.find((s) => s.id === activeServerId);
  // Only owners and moderators ever open this (see Chat.tsx); a moderator
  // gets just the members and bans tabs — the rest stays the owner's.
  const myRole: MemberRole = server?.my_role ?? 'owner';
  const isOwner = myRole === 'owner';
  const [tab, setTab] = useState<Tab>(isOwner ? 'general' : 'members');

  if (!server) return null;

  return (
    <Modal title={t('Sunucu Ayarları — {name}', { name: server.name })} onClose={onClose}>
      <div className="settings-tabs">
        {isOwner && (
          <>
            <button
              className={`settings-tab${tab === 'general' ? ' active' : ''}`}
              onClick={() => setTab('general')}
            >
              {t('Genel Ayarlar')}
            </button>
            <button
              className={`settings-tab${tab === 'channels' ? ' active' : ''}`}
              onClick={() => setTab('channels')}
            >
              {t('Kanalları Yönet')}
            </button>
          </>
        )}
        <button
          className={`settings-tab${tab === 'members' ? ' active' : ''}`}
          onClick={() => setTab('members')}
        >
          {t('Üyeler')}
        </button>
        <button
          className={`settings-tab${tab === 'bans' ? ' active' : ''}`}
          onClick={() => setTab('bans')}
        >
          {t('Yasaklılar')}
        </button>
        <button
          className={`settings-tab${tab === 'reports' ? ' active' : ''}`}
          onClick={() => setTab('reports')}
        >
          {t('Raporlar')}
        </button>
        {isOwner && (
          <button
            className={`settings-tab${tab === 'invites' ? ' active' : ''}`}
            onClick={() => setTab('invites')}
          >
            {t('Davet Linkleri')}
          </button>
        )}
      </div>

      {isOwner && tab === 'general' && <GeneralTab server={server} onClose={onClose} />}
      {isOwner && tab === 'channels' && <ChannelsTab channels={channels} />}
      {tab === 'members' && <MembersTab serverId={server.id} myRole={myRole} />}
      {tab === 'bans' && <BansTab serverId={server.id} />}
      {tab === 'reports' && <ReportsTab serverId={server.id} />}
      {isOwner && tab === 'invites' && <InvitesTab serverId={server.id} />}
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

  async function handleIconSave(url: string | null) {
    const { data, error } = await updateServerIcon(server.id, url);
    if (error || !data) return error ?? t('İkon kaydedilemedi');
    useServerStore.getState().handleServerUpdated({
      server_id: data.id,
      name: data.name,
      icon_url: data.icon_url ?? null,
    });
    return undefined;
  }

  return (
    <div className="settings-section">
      <ImagePicker
        label={t('Sunucu İkonu')}
        currentUrl={server.icon_url}
        fallback={serverInitials(server.name)}
        onSave={handleIconSave}
      />
      <label className="settings-label" htmlFor="server-name-input">
        {t('Sunucu Adı')}
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
          {saved ? t('Kaydedildi!') : t('Kaydet')}
        </button>
      </div>

      {error && <div className="settings-error"><AlertTriangle size={14} /> {error}</div>}

      <div className="settings-danger-zone">
        <h4 className="settings-danger-title">{t('Tehlikeli Bölge')}</h4>
        <p className="settings-danger-description">
          {t('Sunucuyu silmek geri alınamaz; tüm kanallar, mesajlar ve üyelikler kalıcı olarak silinir.')}
        </p>
        {confirmingDelete ? (
          <div className="settings-row">
            <button
              className="settings-confirm-delete-btn"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? t('Siliniyor…') : t('Evet, Sunucuyu Sil')}
            </button>
            <button
              className="settings-cancel-btn"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
            >
              {t('Vazgeç')}
            </button>
          </div>
        ) : (
          <button className="settings-delete-btn" onClick={() => setConfirmingDelete(true)}>
            {t('Sunucuyu Sil')}
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
              title={t('Kanalı Sil')}
              aria-label={t('{name} kanalını sil', { name: channel.name })}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {channels.length === 0 && <li className="list-empty-hint">{t('Henüz kanal yok.')}</li>}
      </ul>
    </div>
  );
}

function MembersTab({ serverId, myRole }: { serverId: string; myRole: MemberRole }) {
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kickingId, setKickingId] = useState<string | null>(null);
  // Banning is harder to undo than a kick (it also blocks rejoining), so
  // it takes a second, explicit confirmation with an optional reason.
  const [banTargetId, setBanTargetId] = useState<string | null>(null);
  const [banReason, setBanReason] = useState('');
  const [banning, setBanning] = useState(false);
  const [roleChangingId, setRoleChangingId] = useState<string | null>(null);
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
        setError(error ?? t('Üye listesi alınamadı'));
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

  async function handleRoleChange(userId: string, role: 'moderator' | 'member') {
    setRoleChangingId(userId);
    setError('');
    const { error } = await setMemberRole(serverId, userId, role);
    setRoleChangingId(null);

    if (error) {
      setError(error);
      return;
    }
    setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)));
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
    return <div className="settings-section">{t('Yükleniyor…')}</div>;
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
                {member.username ?? t('Bilinmeyen')}
                {member.role === 'owner' && <span className="settings-owner-badge">{t('Sahip')}</span>}
                {member.role === 'moderator' && <span className="settings-owner-badge">{t('Moderatör')}</span>}
              </span>
              {canModerate(myRole, member.role) && (
                <span className="settings-member-actions">
                  {myRole === 'owner' && (
                    <button
                      className="settings-icon-btn"
                      onClick={() =>
                        handleRoleChange(member.user_id, member.role === 'moderator' ? 'member' : 'moderator')
                      }
                      disabled={roleChangingId === member.user_id}
                      title={member.role === 'moderator' ? t('Moderatörlüğünü Al') : t('Moderatör Yap')}
                      aria-label={
                        member.role === 'moderator'
                          ? t('{name} moderatörlüğünü al', { name: member.username ?? t('kullanıcının') })
                          : t('{name} moderatör yap', { name: member.username ?? t('kullanıcıyı') })
                      }
                    >
                      {member.role === 'moderator' ? <ShieldOff size={14} /> : <Shield size={14} />}
                    </button>
                  )}
                  <button
                    className="settings-icon-btn"
                    onClick={() => handleKick(member.user_id)}
                    disabled={kickingId === member.user_id}
                    title={t('Sunucudan At')}
                    aria-label={t('{name} sunucudan at', { name: member.username ?? t('kullanıcıyı') })}
                  >
                    <UserX size={14} />
                  </button>
                  <button
                    className="settings-icon-btn"
                    onClick={() => {
                      setBanTargetId(member.user_id);
                      setBanReason('');
                    }}
                    title={t('Sunucudan Yasakla')}
                    aria-label={t('{name} sunucudan yasakla', { name: member.username ?? t('kullanıcıyı') })}
                  >
                    <Ban size={14} />
                  </button>
                </span>
              )}
              {banTargetId === member.user_id && (
                <div className="settings-ban-confirm">
                  <input
                    className="settings-input"
                    placeholder={t('Sebep (isteğe bağlı)')}
                    aria-label={t('Yasaklama sebebi')}
                    value={banReason}
                    maxLength={200}
                    onChange={(e) => setBanReason(e.target.value)}
                  />
                  <button
                    className="settings-confirm-delete-btn"
                    onClick={() => handleBan(member.user_id)}
                    disabled={banning}
                  >
                    {banning ? t('Yasaklanıyor…') : t('Yasakla')}
                  </button>
                  <button className="settings-cancel-btn" onClick={() => setBanTargetId(null)}>
                    {t('Vazgeç')}
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
      if (error || !data) setError(error ?? t('Yasak listesi alınamadı'));
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
    return <div className="settings-section">{t('Yükleniyor…')}</div>;
  }

  return (
    <div className="settings-section">
      {error && <div className="settings-error"><AlertTriangle size={14} /> {error}</div>}
      <ul className="settings-list">
        {bans.map((ban) => (
          <li key={ban.user_id} className="settings-list-item">
            <span>
              {ban.username ?? t('Bilinmeyen')}
              {ban.reason && <span className="settings-ban-reason"> — {ban.reason}</span>}
            </span>
            <button
              className="settings-cancel-btn"
              onClick={() => handleUnban(ban.user_id)}
              disabled={liftingId === ban.user_id}
            >
              {t('Yasağı kaldır')}
            </button>
          </li>
        ))}
        {bans.length === 0 && <li className="list-empty-hint">{t('Yasaklı kullanıcı yok.')}</li>}
      </ul>
    </div>
  );
}

function ReportsTab({ serverId }: { serverId: string }) {
  const [reports, setReports] = useState<ServerReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const clearReportMarker = useServerStore((s) => s.clearReportMarker);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    clearReportMarker(serverId);
    fetchServerReports(serverId).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) setError(error ?? t('Raporlar alınamadı'));
      else setReports(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [serverId, clearReportMarker]);

  async function handleReview(reportId: string, status: 'resolved' | 'dismissed') {
    setReviewingId(reportId);
    setError('');
    const { error } = await reviewReport(serverId, reportId, status);
    setReviewingId(null);
    if (error) {
      setError(error);
      return;
    }
    setReports((prev) => prev.filter((r) => r.id !== reportId));
  }

  if (loading) {
    return <div className="settings-section">{t('Yükleniyor…')}</div>;
  }

  return (
    <div className="settings-section">
      {error && <div className="settings-error"><AlertTriangle size={14} /> {error}</div>}
      <ul className="settings-list">
        {reports.map((report) => (
          <li key={report.id} className="settings-list-item settings-report-item">
            <div className="settings-report-head">
              <span>
                <strong>{report.reported_user.username ?? t('Bilinmeyen')}</strong>
                <span className="settings-owner-badge">{reportReasonLabel(report.reason)}</span>
              </span>
              <span className="settings-report-meta">
                {t('Raporlayan: {name}', { name: report.reporter.username ?? t('Bilinmeyen') })} ·{' '}
                {formatExpiresAt(report.created_at)}
              </span>
            </div>
            <div className="settings-report-content">
              {report.content || (report.file_url ? t('Dosya eki') : t('(boş mesaj)'))}
            </div>
            {report.details && <div className="settings-report-meta">{report.details}</div>}
            <div className="settings-report-actions">
              <button
                className="settings-cancel-btn"
                onClick={() => handleReview(report.id, 'dismissed')}
                disabled={reviewingId === report.id}
              >
                {t('Yoksay')}
              </button>
              <button
                className="settings-confirm-delete-btn"
                onClick={() => handleReview(report.id, 'resolved')}
                disabled={reviewingId === report.id}
              >
                {t('Çözüldü')}
              </button>
            </div>
          </li>
        ))}
        {reports.length === 0 && <li className="list-empty-hint">{t('Açık rapor yok.')}</li>}
      </ul>
    </div>
  );
}

function formatExpiresAt(expiresAt: string | null): string {
  if (!expiresAt) return t('Süresiz');
  const date = new Date(expiresAt.includes('Z') ? expiresAt : expiresAt + 'Z');
  return date.toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
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
        setError(error ?? t('Davet listesi alınamadı'));
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
    return <div className="settings-section">{t('Yükleniyor…')}</div>;
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
                    ? t('Süresi doldu')
                    : maxedOut
                      ? t('Kullanım limiti doldu')
                      : formatExpiresAt(invite.expires_at)}
                  {' · '}
                  {t('{uses} kullanım', {
                    uses: invite.max_uses !== null ? `${invite.uses_count}/${invite.max_uses}` : invite.uses_count,
                  })}
                </span>
              </span>
              <button
                className="settings-icon-btn"
                onClick={() => handleRevoke(invite.id)}
                disabled={revokingId === invite.id}
                title={t('Daveti İptal Et')}
                aria-label={t('{code} kodlu daveti iptal et', { code: invite.code })}
              >
                <Trash2 size={14} />
              </button>
            </li>
          );
        })}
        {invites.length === 0 && <li className="list-empty-hint">{t('Henüz davet linki yok.')}</li>}
      </ul>
    </div>
  );
}
