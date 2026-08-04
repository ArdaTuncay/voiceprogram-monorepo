export interface NotificationPreferences {
  /** Master switch — off means no sound, no desktop popup, regardless of
   * the other three. Doesn't touch the unread-dot/badge system (that's
   * ordinary navigation state, not a "notification" in this sense). */
  enabled: boolean;
  /** Plays a short beep (Web Audio, no asset file) on a new message. */
  sound: boolean;
  /** Browser Notification API popups — see useSocketStore.ts. */
  desktop: boolean;
  /** Only notify (sound/desktop) when the message @-mentions you — server
   * channels only; a DM is always "about you" by definition, so this
   * doesn't apply there. */
  mentionsOnly: boolean;
}

const STORAGE_KEY = 'zircle-notification-prefs';

// Desktop defaults true to preserve the app's pre-existing behavior
// (it already asked for Notification permission up front and showed a
// popup whenever granted, with no way to turn it off) — adding this
// preference shouldn't silently change that for anyone who already
// granted permission. Sound is a new feature, opt-in by default.
const DEFAULTS: NotificationPreferences = {
  enabled: true,
  sound: false,
  desktop: true,
  mentionsOnly: false,
};

function isPreferences(value: unknown): value is NotificationPreferences {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.enabled === 'boolean' &&
    typeof v.sound === 'boolean' &&
    typeof v.desktop === 'boolean' &&
    typeof v.mentionsOnly === 'boolean'
  );
}

export function getNotificationPreferences(): NotificationPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULTS;
    const parsed = JSON.parse(stored);
    return isPreferences(parsed) ? parsed : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function setNotificationPreferences(prefs: NotificationPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Preference just won't persist across reloads — not worth surfacing.
  }
}

/** Reads the current preferences, flips one field, persists and returns
 * the full updated object — what the settings toggles call. */
export function updateNotificationPreference<K extends keyof NotificationPreferences>(
  key: K,
  value: NotificationPreferences[K]
): NotificationPreferences {
  const next = { ...getNotificationPreferences(), [key]: value };
  setNotificationPreferences(next);
  return next;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Simple "@username" text match — this project has no real mention
 * system (no autocomplete, no backend-tracked mention list), so this is a
 * pragmatic heuristic for the mentions-only notification filter rather
 * than a full mention feature. Word-bounded and case-insensitive, so
 * "@ard" doesn't match a user named "ardent". */
export function isMentioned(content: string, username: string): boolean {
  if (!username) return false;
  const pattern = new RegExp(`(^|\\W)@${escapeRegExp(username)}(?!\\w)`, 'i');
  return pattern.test(content);
}

/** Short beep via Web Audio — no audio asset needed. Silently does nothing
 * if the browser has no AudioContext (very old browsers) or playback is
 * blocked (e.g. no user gesture yet on this page load). */
export function playNotificationSound(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.25);
    oscillator.onended = () => void ctx.close();
  } catch {
    // Best-effort — a failed beep shouldn't break the notification itself.
  }
}
