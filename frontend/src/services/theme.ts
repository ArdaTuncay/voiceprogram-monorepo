export type Theme = 'dark' | 'light';

// Kept in sync by hand with the inline bootstrap script in index.html,
// which can't import this module (it has to run as a plain, synchronous
// classic script — before any module script — to set data-theme ahead of
// the first paint and avoid a flash of the wrong theme).
export const THEME_STORAGE_KEY = 'zircle-theme';

function isTheme(value: string | null): value is Theme {
  return value === 'dark' || value === 'light';
}

/** Stored preference, else system preference, else 'dark'. */
export function getPreferredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // localStorage unavailable (privacy mode, etc.) — fall through.
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme just won't persist across reloads — not worth surfacing.
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

/** Flips the current theme, persists it, and returns the new value — for
 * the profile-bar toggle button. */
export function toggleTheme(): Theme {
  const next: Theme = getCurrentTheme() === 'light' ? 'dark' : 'light';
  applyTheme(next);
  setStoredTheme(next);
  return next;
}
