import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMediaPreferences,
  resolveMicConstraint,
  setMediaPreferences,
  supportsOutputDeviceSelection,
  updateMediaPreference,
} from '../mediaPreferences';

const STORAGE_KEY = 'zircle-media-prefs';

function mockEnumerateDevices(devices: Partial<MediaDeviceInfo>[]) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: vi.fn().mockResolvedValue(devices) },
  });
}

describe('mediaPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getMediaPreferences', () => {
    it('defaults to system-default mic and speaker when nothing is stored', () => {
      expect(getMediaPreferences()).toEqual({ micDeviceId: null, speakerDeviceId: null });
    });

    it('falls back to defaults for corrupted JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not valid json');
      expect(getMediaPreferences()).toEqual({ micDeviceId: null, speakerDeviceId: null });
    });

    it('falls back to defaults for a validly-parsed but wrong shape', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ micDeviceId: 42 }));
      expect(getMediaPreferences()).toEqual({ micDeviceId: null, speakerDeviceId: null });
    });
  });

  describe('setMediaPreferences / round-trip', () => {
    it('persists and reads back a full preferences object', () => {
      setMediaPreferences({ micDeviceId: 'mic-1', speakerDeviceId: 'speaker-1' });
      expect(getMediaPreferences()).toEqual({ micDeviceId: 'mic-1', speakerDeviceId: 'speaker-1' });
    });
  });

  describe('updateMediaPreference', () => {
    it('flips a single field and leaves the rest untouched', () => {
      setMediaPreferences({ micDeviceId: 'mic-1', speakerDeviceId: null });

      const result = updateMediaPreference('speakerDeviceId', 'speaker-2');

      expect(result).toEqual({ micDeviceId: 'mic-1', speakerDeviceId: 'speaker-2' });
      expect(getMediaPreferences()).toEqual(result);
    });
  });

  describe('supportsOutputDeviceSelection', () => {
    it('reflects whether HTMLMediaElement.prototype has setSinkId', () => {
      // jsdom's HTMLMediaElement has no setSinkId — this documents the
      // real "Firefox-like" environment this test suite runs under, and
      // that the settings UI is expected to hide the speaker picker there.
      expect(supportsOutputDeviceSelection()).toBe(false);
    });
  });

  describe('resolveMicConstraint', () => {
    it('returns true (default mic) when nothing is saved', async () => {
      await expect(resolveMicConstraint()).resolves.toBe(true);
    });

    it('returns an exact deviceId constraint when the saved mic is still present', async () => {
      setMediaPreferences({ micDeviceId: 'mic-1', speakerDeviceId: null });
      mockEnumerateDevices([
        { deviceId: 'mic-1', kind: 'audioinput' },
        { deviceId: 'mic-2', kind: 'audioinput' },
      ]);

      await expect(resolveMicConstraint()).resolves.toEqual({ deviceId: { exact: 'mic-1' } });
    });

    it('falls back to true when the saved mic is no longer among the input devices', async () => {
      setMediaPreferences({ micDeviceId: 'unplugged-mic', speakerDeviceId: null });
      mockEnumerateDevices([{ deviceId: 'mic-2', kind: 'audioinput' }]);

      await expect(resolveMicConstraint()).resolves.toBe(true);
    });

    it('falls back to true when enumerateDevices itself fails', async () => {
      setMediaPreferences({ micDeviceId: 'mic-1', speakerDeviceId: null });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { enumerateDevices: vi.fn().mockRejectedValue(new Error('denied')) },
      });

      await expect(resolveMicConstraint()).resolves.toBe(true);
    });

    it('ignores an audiooutput device with a matching id — only audioinput counts', async () => {
      setMediaPreferences({ micDeviceId: 'shared-id', speakerDeviceId: null });
      mockEnumerateDevices([{ deviceId: 'shared-id', kind: 'audiooutput' }]);

      await expect(resolveMicConstraint()).resolves.toBe(true);
    });
  });
});
