/**
 * The playback math behind "Birlikte izle" (see hooks/useWatchParty.ts and
 * Backend.WatchParty): where the shared video should be right now, what a
 * local player has to do to get there, and whether something the local
 * player just did was the user (to send to everyone) or just us following
 * the shared state (to ignore).
 */
import type { WatchSource, WatchVideo } from '../types';

/** Further off than this (seconds) and the player jumps to the right spot. */
export const SEEK_THRESHOLD = 0.75;
/** Between this and SEEK_THRESHOLD a <video> catches up by playing a little
 * faster/slower instead — unnoticeable, unlike a jump. */
export const NUDGE_THRESHOLD = 0.2;
const NUDGE_RATE = 0.05;
/** A local play/seek this close to where the shared state already is was
 * us following it, not the user doing something new. */
export const LOCAL_ACTION_TOLERANCE = 1.5;

/** Where the shared video should be at server time `serverNow` (ms). */
export function expectedPosition(video: WatchVideo, serverNow: number, duration?: number | null): number {
  const elapsed = video.playing ? Math.max(0, serverNow - video.updated_at) / 1000 : 0;
  const position = video.position + elapsed;
  return duration && duration > 0 ? Math.min(position, duration) : position;
}

/**
 * Lines the local clock up with the server's from ping round trips: the
 * server read its clock somewhere in the middle of the trip, so the sample
 * with the shortest trip is the most accurate one.
 */
export class ClockSync {
  private samples: { rtt: number; offset: number }[] = [];

  addSample(sentAt: number, serverTime: number, receivedAt: number): void {
    const rtt = receivedAt - sentAt;
    if (rtt < 0) return;
    this.samples = [...this.samples, { rtt, offset: serverTime - (sentAt + rtt / 2) }].slice(-5);
  }

  get offset(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
  }

  now(localNow: number = Date.now()): number {
    return localNow + this.offset;
  }
}

export interface LocalPlayback {
  time: number;
  playing: boolean;
  buffering: boolean;
  ended: boolean;
  duration: number | null;
}

export type Correction =
  | { kind: 'none'; rate: number }
  | { kind: 'seek'; to: number; rate: number }
  | { kind: 'play'; to: number | null }
  | { kind: 'pause'; to: number | null };

/**
 * What the local player needs to do to match the shared state. `canNudge`:
 * whether it can play at 1.05x/0.95x (a <video> can; YouTube's embed only
 * offers coarse steps, so it always jumps instead).
 */
export function decideCorrection(
  local: LocalPlayback,
  video: WatchVideo,
  serverNow: number,
  canNudge: boolean
): Correction {
  const expected = expectedPosition(video, serverNow, local.duration);
  const drift = local.time - expected;

  // Mid-buffer, the player can't act on anything — check again once it can.
  if (local.buffering) return { kind: 'none', rate: 1 };

  if (video.playing) {
    // Played to the end: restarting it would replay from the beginning.
    if (local.ended && local.duration && expected >= local.duration - 1) {
      return { kind: 'none', rate: 1 };
    }
    if (!local.playing) {
      return { kind: 'play', to: Math.abs(drift) > SEEK_THRESHOLD ? expected : null };
    }
    if (Math.abs(drift) > SEEK_THRESHOLD) return { kind: 'seek', to: expected, rate: 1 };
    if (canNudge && Math.abs(drift) > NUDGE_THRESHOLD) {
      return { kind: 'none', rate: drift > 0 ? 1 - NUDGE_RATE : 1 + NUDGE_RATE };
    }
    return { kind: 'none', rate: 1 };
  }

  if (local.playing) return { kind: 'pause', to: Math.abs(drift) > NUDGE_THRESHOLD ? expected : null };
  if (Math.abs(drift) > SEEK_THRESHOLD) return { kind: 'seek', to: expected, rate: 1 };
  return { kind: 'none', rate: 1 };
}

export type LocalAction = 'play' | 'pause' | 'seek';

/**
 * Turns something the local player did into the event to send to everyone,
 * or null when it was only the player following the shared state (every
 * correction we apply fires the same play/pause/seek events a user's click
 * does — comparing against the shared state, rather than flagging our own
 * commands, is what keeps those from echoing back to the server).
 */
export function localActionToSend(
  action: LocalAction,
  time: number,
  video: WatchVideo,
  serverNow: number,
  ended: boolean
): { event: LocalAction; position: number } | null {
  const expected = expectedPosition(video, serverNow);
  const near = Math.abs(time - expected) < LOCAL_ACTION_TOLERANCE;

  switch (action) {
    case 'play':
      return video.playing && near ? null : { event: 'play', position: time };
    case 'pause':
      // A <video> also fires "pause" when it reaches the end.
      return !video.playing || ended ? null : { event: 'pause', position: time };
    case 'seek':
      return near ? null : { event: 'seek', position: time };
  }
}

/** Identifies a source, so the same video loaded again keeps its player. */
export function sourceKey(source: WatchSource): string {
  return source.kind === 'youtube' ? `youtube:${source.id}` : `url:${source.url}`;
}

/** Where the video's data comes from — what a viewer agrees to load. */
export function sourceHost(source: WatchSource): string {
  if (source.kind === 'youtube') return 'YouTube';
  try {
    return new URL(source.url).host;
  } catch {
    return source.url;
  }
}
