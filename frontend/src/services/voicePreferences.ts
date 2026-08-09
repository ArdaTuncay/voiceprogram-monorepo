/** Per-peer playback volume (0-1) for remote voice participants — how loud
 * *this* client plays a given peer back, independent of that peer's own mic
 * gain. Same get/set/update shape as mediaPreferences.ts, keyed by the
 * peer's user_id rather than a device id. */
export type PeerVolumes = Record<string, number>;

const STORAGE_KEY = 'zircle-peer-volumes';

function isPeerVolumes(value: unknown): value is PeerVolumes {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value as Record<string, unknown>).every(
    (v) => typeof v === 'number' && v >= 0 && v <= 1
  );
}

export function getPeerVolumes(): PeerVolumes {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    return isPeerVolumes(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function setPeerVolumes(volumes: PeerVolumes): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(volumes));
  } catch {
    // Preference just won't persist across reloads — not worth surfacing.
  }
}

/** Clamped to [0, 1] — callers (e.g. a <input type="range"> at 0-100%) can
 * pass a raw computed value without needing their own guard. */
export function updatePeerVolume(peerId: string, volume: number): PeerVolumes {
  const clamped = Math.min(1, Math.max(0, volume));
  const next = { ...getPeerVolumes(), [peerId]: clamped };
  setPeerVolumes(next);
  return next;
}
