import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import type { MemberRole, PresenceUser, ServerMember } from '../types';
import { fetchServerMembers } from '../services/api';
import { useServerStore } from '../stores/useServerStore';
import { userColor, initials } from '../utils';
import { t, useT, type MessageKey } from '../i18n';
import AvatarFace from './AvatarFace';
import StatusIndicator from './StatusIndicator';
import './MembersPanel.css';

interface Props {
  serverId: string;
  /** Who's online in this server right now (channel presence) — the
   * collapsed list, same as the old right sidebar. */
  onlineUsers: PresenceUser[];
  currentUserId: string;
}

const ROLE_GROUPS: { role: MemberRole; label: MessageKey }[] = [
  { role: 'owner', label: 'Sahip' },
  { role: 'moderator', label: 'Moderatörler' },
  { role: 'member', label: 'Üyeler' },
];

const ROLE_TAGS: Partial<Record<MemberRole, MessageKey>> = {
  owner: 'Sahip',
  moderator: 'Moderatör',
};

/**
 * The right-hand member card. Collapsed (the default) it lists who's online,
 * exactly like the old online sidebar. Its arrow opens the full member list
 * — everyone in the server, grouped by role, offline people dimmed — fetched
 * from GET /servers/:id/members each time it's opened, so joins and kicks
 * since the last look show up.
 */
export default function MembersPanel({ serverId, onlineUsers, currentUserId }: Props) {
  useT();
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<ServerMember[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Live status updates win over the fetched seed value — same rule as
  // ServerSettingsModal's member list.
  const memberStatuses = useServerStore((s) => s.memberStatuses);

  useEffect(() => {
    setMembers(null);
  }, [serverId]);

  // Fetched on mount and on every server switch (the collapsed list uses it
  // for the owner/moderator tags), and again each time the card is opened
  // so the full list is never stale.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchServerMembers(serverId).then(({ data, error: fetchError }) => {
      if (cancelled) return;
      if (fetchError || !data) {
        setError(fetchError ?? t('Üye listesi alınamadı'));
      } else {
        setMembers(data);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, serverId]);

  const onlineIds = new Set(onlineUsers.map((u) => u.user_id));
  const isOnline = (member: ServerMember) =>
    onlineIds.has(member.user_id) || (memberStatuses[member.user_id] ?? member.status) === 'online';
  const roleOf = (userId: string) => members?.find((m) => m.user_id === userId)?.role;
  const nameWithYou = (name: string, userId: string) =>
    userId === currentUserId ? `${name} ${t('(sen)')}` : name;

  const count = expanded && members && !error
    ? t('{count} üye', { count: members.length })
    : t('{count} çevrimiçi', { count: onlineUsers.length });

  return (
    <aside className="members-panel" aria-label={t('Sunucu üyeleri')}>
      <div className={`members-card${expanded ? ' expanded' : ''}`}>
        <div className="members-card-header">
          <h2 className="members-card-title">{t('Üyeler')}</h2>
          <span className="members-card-count">{count}</span>
          <button
            type="button"
            className="members-card-toggle"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            aria-controls="members-card-list"
            aria-label={expanded ? t('Yalnız çevrimiçi üyeleri göster') : t('Tüm üyeleri göster')}
            title={expanded ? t('Yalnız çevrimiçi üyeleri göster') : t('Tüm üyeleri göster')}
          >
            <ChevronDown size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="members-card-list online-user-list" id="members-card-list">
          {!expanded &&
            onlineUsers.map((presenceUser) => {
              const name = presenceUser.username ?? t('Bilinmeyen');
              const role = roleOf(presenceUser.user_id);
              const tag = role ? ROLE_TAGS[role] : undefined;
              return (
                <div key={presenceUser.user_id} className="online-user-item">
                  <div className="online-user-avatar-wrapper">
                    <div
                      className="online-user-avatar"
                      style={{ background: userColor(presenceUser.user_id) }}
                      title={name}
                    >
                      <AvatarFace url={presenceUser.avatar_url} fallback={initials(name)} />
                    </div>
                    <StatusIndicator status="online" size={11} className="online-status-dot" />
                  </div>
                  <span className="online-user-name">{nameWithYou(name, presenceUser.user_id)}</span>
                  {tag && <span className="members-role-tag">{t(tag)}</span>}
                </div>
              );
            })}

          {expanded && loading && !members && <div className="list-empty-hint">{t('Yükleniyor…')}</div>}
          {expanded && error && (
            <div className="members-card-error"><AlertTriangle size={14} /> {error}</div>
          )}
          {expanded &&
            members &&
            ROLE_GROUPS.map(({ role, label }) => {
              const group = members
                .filter((m) => m.role === role)
                .sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)));
              if (group.length === 0) return null;
              return (
                <section key={role} className="members-group" aria-label={t(label)}>
                  <h3 className="members-group-title">
                    {t(label)} <span className="members-group-count">{group.length}</span>
                  </h3>
                  {group.map((member) => {
                    const name = member.username ?? t('Bilinmeyen');
                    const online = isOnline(member);
                    const tag = ROLE_TAGS[member.role];
                    return (
                      <div
                        key={member.user_id}
                        className={`online-user-item members-row${online ? '' : ' offline'}`}
                      >
                        <div className="online-user-avatar-wrapper">
                          <div
                            className="online-user-avatar"
                            style={{ background: userColor(member.user_id) }}
                            title={name}
                          >
                            <AvatarFace url={member.avatar_url} fallback={initials(name)} />
                          </div>
                          <StatusIndicator
                            status={online ? 'online' : 'offline'}
                            size={11}
                            className="online-status-dot"
                          />
                        </div>
                        <span className="online-user-name">{nameWithYou(name, member.user_id)}</span>
                        {tag && <span className="members-role-tag">{t(tag)}</span>}
                      </div>
                    );
                  })}
                </section>
              );
            })}
        </div>
      </div>
    </aside>
  );
}
