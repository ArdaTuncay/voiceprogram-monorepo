import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  getCurrentTheme,
  getPreferredTheme,
  getStoredPreference,
  initTheme,
  resolveTheme,
  setStoredPreference,
  setThemePreference,
  THEME_STORAGE_KEY,
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

  describe('getStoredPreference', () => {
    it('returns the stored explicit override when one exists', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      expect(getStoredPreference()).toBe('light');
    });

    it('returns "system" when nothing is stored', () => {
      expect(getStoredPreference()).toBe('system');
    });

    it('returns "system" for a corrupted/unexpected stored value', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
      expect(getStoredPreference()).toBe('system');
    });
  });

  describe('resolveTheme', () => {
    it('passes explicit themes through unchanged', () => {
      expect(resolveTheme('light')).toBe('light');
      expect(resolveTheme('dark')).toBe('dark');
    });

    it('resolves "system" via the OS preference', () => {
      mockSystemPreference(true);
      expect(resolveTheme('system')).toBe('light');

      mockSystemPreference(false);
      expect(resolveTheme('system')).toBe('dark');
    });
  });

  describe('getPreferredTheme', () => {
    it('returns the stored override when one exists', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      expect(getPreferredTheme()).toBe('light');
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

  describe('setStoredPreference', () => {
    it('writes an explicit preference under the zircle-theme key', () => {
      setStoredPreference('light');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });

    it('clears the key when set back to "system"', () => {
      setStoredPreference('light');
      setStoredPreference('system');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });
  });

  describe('initTheme', () => {
    it('applies and returns the preferred theme', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      expect(initTheme()).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });

  describe('setThemePreference', () => {
    it('persists an explicit preference and applies it', () => {
      const result = setThemePreference('light');

      expect(result).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });

    it('switching to "system" clears the stored override and resolves via the OS preference', () => {
      setThemePreference('dark');
      mockSystemPreference(true);

      const result = setThemePreference('system');

      expect(result).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });
  });
});
