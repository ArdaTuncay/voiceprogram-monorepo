import { beforeEach, describe, expect, it } from 'vitest';
import {
  getNotificationPreferences,
  isMentioned,
  setNotificationPreferences,
  updateNotificationPreference,
} from '../notificationPreferences';

const STORAGE_KEY = 'zircle-notification-prefs';

describe('notificationPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getNotificationPreferences', () => {
    it('defaults to enabled+desktop on, sound+mentionsOnly off, when nothing is stored', () => {
      expect(getNotificationPreferences()).toEqual({
        enabled: true,
        sound: false,
        desktop: true,
        mentionsOnly: false,
      });
    });

    it('falls back to defaults for corrupted JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not valid json');
      expect(getNotificationPreferences()).toEqual({
        enabled: true,
        sound: false,
        desktop: true,
        mentionsOnly: false,
      });
    });

    it('falls back to defaults for a validly-parsed but wrong shape', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: 'yes' }));
      expect(getNotificationPreferences().enabled).toBe(true);
    });
  });

  describe('setNotificationPreferences / round-trip', () => {
    it('persists and reads back a full preferences object', () => {
      setNotificationPreferences({ enabled: false, sound: true, desktop: false, mentionsOnly: true });

      expect(getNotificationPreferences()).toEqual({
        enabled: false,
        sound: true,
        desktop: false,
        mentionsOnly: true,
      });
    });
  });

  describe('updateNotificationPreference', () => {
    it('flips a single field and leaves the rest untouched', () => {
      setNotificationPreferences({ enabled: true, sound: false, desktop: true, mentionsOnly: false });

      const result = updateNotificationPreference('sound', true);

      expect(result).toEqual({ enabled: true, sound: true, desktop: true, mentionsOnly: false });
      expect(getNotificationPreferences()).toEqual(result);
    });

    it('works from the default state when nothing was stored yet', () => {
      const result = updateNotificationPreference('mentionsOnly', true);

      expect(result.mentionsOnly).toBe(true);
      expect(result.enabled).toBe(true);
    });
  });

  describe('isMentioned', () => {
    it('matches a plain @username mention', () => {
      expect(isMentioned('hey @ard check this out', 'ard')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isMentioned('hey @ARD', 'ard')).toBe(true);
    });

    it('does not match when the username is merely a substring of a longer word', () => {
      expect(isMentioned('hey @ardent, how are you', 'ard')).toBe(false);
    });

    it('does not match when there is no @ at all', () => {
      expect(isMentioned('ard said something', 'ard')).toBe(false);
    });

    it('matches at the start of the message', () => {
      expect(isMentioned('@ard are you there?', 'ard')).toBe(true);
    });

    it('returns false for an empty username', () => {
      expect(isMentioned('@ard hello', '')).toBe(false);
    });
  });
});
