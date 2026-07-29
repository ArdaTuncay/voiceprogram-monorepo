import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  getCurrentTheme,
  getPreferredTheme,
  initTheme,
  setStoredTheme,
  THEME_STORAGE_KEY,
  toggleTheme,
} from '../theme';

function mockSystemPreference(prefersLight: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: light)' && prefersLight,
    media: query,
  })) as unknown as typeof window.matchMedia;
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockSystemPreference(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPreferredTheme', () => {
    it('returns the stored preference when one exists', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      expect(getPreferredTheme()).toBe('light');
    });

    it('ignores a corrupted/unexpected stored value', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
      expect(getPreferredTheme()).toBe('dark');
    });

    it('falls back to the system preference when nothing is stored', () => {
      mockSystemPreference(true);
      expect(getPreferredTheme()).toBe('light');
    });

    it('falls back to dark when neither a stored nor a system preference is available', () => {
      expect(getPreferredTheme()).toBe('dark');
    });
  });

  describe('applyTheme / getCurrentTheme', () => {
    it('sets data-theme on the document root', () => {
      applyTheme('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(getCurrentTheme()).toBe('light');

      applyTheme('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(getCurrentTheme()).toBe('dark');
    });

    it('getCurrentTheme defaults to dark when the attribute is unset', () => {
      expect(getCurrentTheme()).toBe('dark');
    });
  });

  describe('setStoredTheme', () => {
    it('writes the theme under the zircle-theme key', () => {
      setStoredTheme('light');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });
  });

  describe('initTheme', () => {
    it('applies and returns the preferred theme', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      expect(initTheme()).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });

  describe('toggleTheme', () => {
    it('flips dark to light, persisting and applying it', () => {
      applyTheme('dark');
      const result = toggleTheme();

      expect(result).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });

    it('flips light back to dark', () => {
      applyTheme('light');
      const result = toggleTheme();

      expect(result).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });
  });
});
