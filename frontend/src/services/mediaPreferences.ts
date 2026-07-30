export interface MediaPreferences {
  /** `null` means "system default" — never force a device that might not exist. */
  micDeviceId: string | null;
  speakerDeviceId: string | null;
}

const STORAGE_KEY = 'zircle-media-prefs';

const DEFAULTS: MediaPreferences = {
  micDeviceId: null,
  speakerDeviceId: null,
};

function isPreferences(value: unknown): value is MediaPreferences {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (typeof v.micDeviceId === 'string' || v.micDeviceId === null) &&
    (typeof v.speakerDeviceId === 'string' || v.speakerDeviceId === null)
  );
}

export function getMediaPreferences(): MediaPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULTS;
    const parsed = JSON.parse(stored);
    return isPreferences(parsed) ? parsed : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function setMediaPreferences(prefs: MediaPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Preference just won't persist across reloads — not worth surfacing.
  }
}

export function updateMediaPreference<K extends keyof MediaPreferences>(
  key: K,
  value: MediaPreferences[K]
): MediaPreferences {
  const next = { ...getMediaPreferences(), [key]: value };
  setMediaPreferences(next);
  return next;
}

/** Firefox (as of this writing) has no HTMLMediaElement.setSinkId — the
 * output-device dropdown should be hidden there entirely rather than
 * shown and silently do nothing. */
export function supportsOutputDeviceSelection(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

/**
 * Resolves the saved microphone preference to a `getUserMedia` audio
 * constraint — `true` (plain default mic) if nothing's saved, or if the
 * saved device is no longer among the system's current input devices
 * (unplugged, permissions revoked, etc.). This is the "don't ever let a
 * stale device id block joining a voice channel" fallback useVoiceChannel.ts
 * relies on; see its join()'s own retry for the narrower race where the
 * device disappears *after* this check but before getUserMedia runs.
 */
export async function resolveMicConstraint(): Promise<MediaTrackConstraints | true> {
  const { micDeviceId } = getMediaPreferences();
  if (!micDeviceId) return true;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const stillPresent = devices.some(
      (d) => d.kind === 'audioinput' && d.deviceId === micDeviceId
    );
    return stillPresent ? { deviceId: { exact: micDeviceId } } : true;
  } catch {
    return true;
  }
}
