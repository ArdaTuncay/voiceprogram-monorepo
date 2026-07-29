export type Theme = 'dark' | 'light';

/** What's actually persisted: an explicit override, or 'system' (the
 * implicit default when nothing's stored) meaning "follow the OS". */
export type ThemePreference = Theme | 'system';

// Kept in sync by hand with the inline bootstrap script in index.html,
// which can't import this module (it has to run as a plain, synchronous
// classic script — before any module script — to set data-theme ahead of
// the first paint and avoid a flash of the wrong theme). That script only
// ever writes/reads an explicit 'dark'/'light' string or nothing at all,
// so it doesn't need to know about the 'system' value below — "anything
// that isn't exactly 'light' or 'dark'" already falls through to its own
// prefers-color-scheme check, which is the same thing 'system' means here.
export const THEME_STORAGE_KEY = 'zircle-theme';

function isExplicitTheme(value: string | null): value is Theme {
  return value === 'dark' || value === 'light';
}

function prefersLightSystemTheme(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: light)').matches;
}

/** The raw stored preference — an explicit override, or 'system' if nothing
 * (valid) is stored. Used by the Appearance settings screen to know which
 * of the three options to show as selected. */
export function getStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isExplicitTheme(stored)) return stored;
  } catch {
    // localStorage unavailable (privacy mode, etc.) — fall through.
  }
  return 'system';
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === 'system' ? (prefersLightSystemTheme() ? 'light' : 'dark') : preference;
}

/** Stored preference resolved to an actual applyable theme. */
export function getPreferredTheme(): Theme {
  return resolveTheme(getStoredPreference());
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

/** Persists an explicit override, or clears it back to 'system'. Doesn't
 * touch the DOM itself — see setThemePreference for the UI-facing version
 * that also applies the resolved theme immediately. */
export function setStoredPreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Preference just won't persist across reloads — not worth surfacing.
  }
}

export function getCurrentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** Applies the preferred theme to <html> — call once on startup. Separate
 * from getPreferredTheme so callers that only need the value (e.g. to
 * initialize UI state) don't have to also touch the DOM. */
export function initTheme(): Theme {
  const theme = getPreferredTheme();
  applyTheme(theme);
  return theme;
}

/** Used by the Appearance settings screen's theme selector — persists the
 * chosen preference (or clears it, for 'system') and immediately applies
 * its resolved theme. */
export function setThemePreference(preference: ThemePreference): Theme {
  setStoredPreference(preference);
  const theme = resolveTheme(preference);
  applyTheme(theme);
  return theme;
}
