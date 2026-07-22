import './StatusIndicator.css';

export type UserPresenceStatus = 'online' | 'idle' | 'in_voice' | 'offline';

interface Props {
  status: UserPresenceStatus;
  /** Diameter in pixels. */
  size?: number;
  /** Merged with the component's own classes — callers use this for
   * positioning (e.g. absolute-placed over the bottom-right corner of an
   * avatar) rather than the component owning its own placement. */
  className?: string;
}

const LABELS: Record<UserPresenceStatus, string> = {
  online: 'Çevrimiçi',
  idle: 'Boşta',
  in_voice: 'Sesli görüşmede',
  offline: 'Çevrimdışı',
};

/** Shared presence dot — used anywhere a user's status needs a small visual
 * marker (friends list, member list, DM/online sidebars). Four states:
 * a filled dot (online), a dashed ring (idle), a filled dot with a thin
 * outer ring (in_voice), or a faint ring-only outline (offline). Callers
 * that only ever distinguish online/offline (no idle/in_voice data from the
 * backend yet) simply never pass those two status values. */
export default function StatusIndicator({ status, size = 10, className }: Props) {
  const label = LABELS[status];
  return (
    <span
      className={`status-indicator status-indicator-${status}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
      title={label}
    >
      {status === 'in_voice' && <span className="status-indicator-dot" />}
    </span>
  );
}
