import { describe, expect, it } from 'vitest';
import type { WatchVideo } from '../../types';
import {
  ClockSync,
  decideCorrection,
  expectedPosition,
  localActionToSend,
  sourceHost,
  sourceKey,
  type LocalPlayback,
} from '../watchSync';

const NOW = 1_000_000;

function video(overrides: Partial<WatchVideo> = {}): WatchVideo {
  return {
    source: { kind: 'youtube', id: 'dQw4w9WgXcQ' },
    playing: true,
    position: 10,
    updated_at: NOW,
    updated_by: 'u1',
    ...overrides,
  };
}

function local(overrides: Partial<LocalPlayback> = {}): LocalPlayback {
  return { time: 10, playing: true, buffering: false, ended: false, duration: 600, ...overrides };
}

describe('expectedPosition', () => {
  it('moves on with the clock while playing', () => {
    expect(expectedPosition(video(), NOW + 5_000)).toBe(15);
  });

  it('stays put while paused', () => {
    expect(expectedPosition(video({ playing: false }), NOW + 5_000)).toBe(10);
  });

  it('never runs past the end', () => {
    expect(expectedPosition(video(), NOW + 10_000_000, 600)).toBe(600);
  });

  it("doesn't go backwards for a clock slightly behind the update", () => {
    expect(expectedPosition(video(), NOW - 500)).toBe(10);
  });
});

describe('ClockSync', () => {
  it('uses the sample with the shortest round trip', () => {
    const clock = new ClockSync();
    // 400 ms trip: offset estimate 5000 - (0 + 200) = 4800 (less accurate).
    clock.addSample(0, 5_000, 400);
    // 20 ms trip: 6010 - (1000 + 10) = 5000.
    clock.addSample(1_000, 6_010, 1_020);
    expect(clock.offset).toBe(5_000);
    expect(clock.now(100)).toBe(5_100);
  });

  it('is zero before any sample', () => {
    expect(new ClockSync().now(42)).toBe(42);
  });
});

describe('decideCorrection', () => {
  it('leaves a player that is in sync alone', () => {
    expect(decideCorrection(local({ time: 10.1 }), video(), NOW, true)).toEqual({ kind: 'none', rate: 1 });
  });

  it('jumps when too far off', () => {
    expect(decideCorrection(local({ time: 4 }), video(), NOW, true)).toEqual({ kind: 'seek', to: 10, rate: 1 });
  });

  it('nudges the rate for a small drift when the player can', () => {
    expect(decideCorrection(local({ time: 10.5 }), video(), NOW, true)).toEqual({ kind: 'none', rate: 0.95 });
    expect(decideCorrection(local({ time: 9.5 }), video(), NOW, true)).toEqual({ kind: 'none', rate: 1.05 });
    expect(decideCorrection(local({ time: 10.5 }), video(), NOW, false)).toEqual({ kind: 'none', rate: 1 });
  });

  it('starts a paused player when everyone is playing', () => {
    expect(decideCorrection(local({ playing: false, time: 10 }), video(), NOW, false)).toEqual({ kind: 'play', to: null });
    expect(decideCorrection(local({ playing: false, time: 0 }), video(), NOW, false)).toEqual({ kind: 'play', to: 10 });
  });

  it('pauses a playing player when everyone has paused', () => {
    expect(decideCorrection(local({ time: 12 }), video({ playing: false }), NOW, false)).toEqual({ kind: 'pause', to: 10 });
  });

  it('moves a paused player to the paused position', () => {
    expect(decideCorrection(local({ playing: false, time: 50 }), video({ playing: false }), NOW, false)).toEqual({
      kind: 'seek',
      to: 10,
      rate: 1,
    });
  });

  it('waits while the player is buffering', () => {
    expect(decideCorrection(local({ buffering: true, time: 0 }), video(), NOW, false)).toEqual({ kind: 'none', rate: 1 });
  });

  it("doesn't restart a video that played to its end", () => {
    const ended = local({ playing: false, ended: true, time: 600 });
    expect(decideCorrection(ended, video({ position: 599.5 }), NOW + 5_000, false)).toEqual({ kind: 'none', rate: 1 });
  });
});

describe('localActionToSend', () => {
  it('ignores the player following the shared state', () => {
    expect(localActionToSend('play', 10.3, video(), NOW, false)).toBeNull();
    expect(localActionToSend('pause', 10, video({ playing: false }), NOW, false)).toBeNull();
    expect(localActionToSend('seek', 10.5, video(), NOW, false)).toBeNull();
  });

  it('sends what the user did', () => {
    expect(localActionToSend('pause', 10.2, video(), NOW, false)).toEqual({ event: 'pause', position: 10.2 });
    expect(localActionToSend('play', 10, video({ playing: false }), NOW, false)).toEqual({ event: 'play', position: 10 });
    expect(localActionToSend('seek', 120, video(), NOW, false)).toEqual({ event: 'seek', position: 120 });
  });

  it('sends a play from somewhere else as a play there', () => {
    expect(localActionToSend('play', 200, video(), NOW, false)).toEqual({ event: 'play', position: 200 });
  });

  it('ignores the pause a <video> fires at its end', () => {
    expect(localActionToSend('pause', 600, video(), NOW, true)).toBeNull();
  });
});

describe('sources', () => {
  it('names where the video comes from', () => {
    expect(sourceHost({ kind: 'youtube', id: 'x' })).toBe('YouTube');
    expect(sourceHost({ kind: 'url', url: 'https://cdn.example.com/a.mp4' })).toBe('cdn.example.com');
  });

  it('keys the same video the same way', () => {
    expect(sourceKey({ kind: 'youtube', id: 'abc' })).toBe(sourceKey({ kind: 'youtube', id: 'abc' }));
    expect(sourceKey({ kind: 'youtube', id: 'abc' })).not.toBe(sourceKey({ kind: 'url', url: 'abc' }));
  });
});
