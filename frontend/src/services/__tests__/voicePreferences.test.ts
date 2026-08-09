import { beforeEach, describe, expect, it } from 'vitest';
import { getPeerVolumes, setPeerVolumes, updatePeerVolume } from '../voicePreferences';

const STORAGE_KEY = 'zircle-peer-volumes';

describe('voicePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getPeerVolumes', () => {
    it('defaults to an empty map when nothing is stored', () => {
      expect(getPeerVolumes()).toEqual({});
    });

    it('falls back to an empty map for corrupted JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not valid json');
      expect(getPeerVolumes()).toEqual({});
    });

    it('falls back to an empty map when a stored value is out of the 0-1 range', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'peer-1': 1.5 }));
      expect(getPeerVolumes()).toEqual({});
    });

    it('falls back to an empty map for a validly-parsed but wrong shape', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'peer-1': 'loud' }));
      expect(getPeerVolumes()).toEqual({});
    });
  });

  describe('setPeerVolumes / round-trip', () => {
    it('persists and reads back a full volumes map', () => {
      setPeerVolumes({ 'peer-1': 0.5, 'peer-2': 0 });
      expect(getPeerVolumes()).toEqual({ 'peer-1': 0.5, 'peer-2': 0 });
    });
  });

  describe('updatePeerVolume', () => {
    it('sets a single peer\'s volume and leaves other peers untouched', () => {
      setPeerVolumes({ 'peer-1': 0.5 });

      const result = updatePeerVolume('peer-2', 0.25);

      expect(result).toEqual({ 'peer-1': 0.5, 'peer-2': 0.25 });
      expect(getPeerVolumes()).toEqual(result);
    });

    it('clamps a value above 1 down to 1', () => {
      const result = updatePeerVolume('peer-1', 2);
      expect(result).toEqual({ 'peer-1': 1 });
    });

    it('clamps a value below 0 up to 0', () => {
      const result = updatePeerVolume('peer-1', -0.3);
      expect(result).toEqual({ 'peer-1': 0 });
    });
  });
});
