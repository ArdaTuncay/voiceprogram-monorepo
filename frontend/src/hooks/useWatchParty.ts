import { useCallback, useEffect, useRef, useState } from 'react';
import type { WatchState, WatchVideo } from '../types';
import { joinWatchParty, type WatchPartyHandle } from '../services/socket';
import { ClockSync, type LocalAction } from '../utils/watchSync';

const CLOCK_SAMPLES_ON_JOIN = 3;
const CLOCK_RESYNC_MS = 60_000;

export interface WatchParty {
  /** The shared video, or null when nothing is open. Includes our own
   * changes right away, before the server has confirmed them. */
  video: WatchVideo | null;
  /** The server's clock now (ms), for expectedPosition(). */
  serverNow: () => number;
  /** Open a link for everyone; rejects with the server's reason. */
  load: (url: string) => Promise<void>;
  /** Tell everyone what this player just did. */
  send: (action: LocalAction, position: number) => void;
  /** Close the video for everyone. */
  clear: () => void;
}

/**
 * "Birlikte izle" for the voice room `roomId` (null when not in one): keeps
 * the room's shared playback state (see Backend.WatchParty) and the
 * server/local clock offset it's expressed in.
 *
 * Our own actions are applied locally straight away (optimistically), so
 * the panel's sync loop doesn't pull the player back to the old state in
 * the moment before the server confirms. While several of ours are still
 * in flight (scrubbing fires a few seeks in a row), the server's echoes of
 * the earlier ones are skipped for the same reason — only the last one, or
 * anything from someone else, replaces the local state.
 */
export function useWatchParty(roomId: string | null, myUserId: string): WatchParty {
  const [state, setState] = useState<WatchState>({ rev: 0, video: null });
  const handleRef = useRef<WatchPartyHandle | null>(null);
  const clockRef = useRef(new ClockSync());
  const inFlightRef = useRef(0);
  // The newest state the server has sent, skipped or not — what a refused
  // action of ours falls back to.
  const confirmedRef = useRef<WatchState>({ rev: 0, video: null });
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;

  // Rev-checked: a reply or broadcast that got overtaken by a newer one
  // must not roll the state back.
  const accept = useCallback((next: WatchState) => {
    if (next.rev >= confirmedRef.current.rev) confirmedRef.current = next;
    if (inFlightRef.current > 0 && next.video?.updated_by === myUserIdRef.current) return;
    setState((prev) => (next.rev >= prev.rev ? next : prev));
  }, []);

  useEffect(() => {
    setState({ rev: 0, video: null });
    confirmedRef.current = { rev: 0, video: null };
    inFlightRef.current = 0;
    if (!roomId) return;

    const clock = new ClockSync();
    clockRef.current = clock;

    const handle = joinWatchParty(roomId, {
      onJoined: (joined, serverTime) => {
        // Taken as-is, not rev-checked: after a server restart the room is
        // new and counts from 0 again.
        confirmedRef.current = joined;
        setState(joined);
        // Rough (assumes a 1 s round trip) until the pings below come back.
        clock.addSample(Date.now() - 1000, serverTime, Date.now());
        for (let i = 0; i < CLOCK_SAMPLES_ON_JOIN; i++) window.setTimeout(ping, i * 300);
      },
      onState: accept,
    });
    handleRef.current = handle;

    function ping() {
      const sentAt = Date.now();
      handle
        .request<{ server_time: number }>('ping')
        .then(({ server_time }) => clock.addSample(sentAt, server_time, Date.now()))
        .catch(() => {});
    }
    const resync = window.setInterval(ping, CLOCK_RESYNC_MS);

    return () => {
      window.clearInterval(resync);
      handle.leave();
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [roomId, accept]);

  const serverNow = useCallback(() => clockRef.current.now(), []);

  const request = useCallback(
    async (event: string, payload: Record<string, unknown> = {}) => {
      const handle = handleRef.current;
      if (!handle) throw new Error('not_joined');
      inFlightRef.current += 1;
      try {
        const next = await handle.request<WatchState>(event, payload);
        inFlightRef.current -= 1;
        accept(next);
      } catch (error) {
        inFlightRef.current -= 1;
        if (inFlightRef.current === 0) setState(confirmedRef.current);
        throw error;
      }
    },
    [accept]
  );

  const load = useCallback((url: string) => request('load', { url }), [request]);

  const send = useCallback(
    (action: LocalAction, position: number) => {
      const now = clockRef.current.now();
      setState((prev) => {
        if (!prev.video) return prev;
        const playing = action === 'play' ? true : action === 'pause' ? false : prev.video.playing;
        return { ...prev, video: { ...prev.video, playing, position, updated_at: now } };
      });
      // A refused one (rate limit) falls back to the confirmed state.
      request(action, { position }).catch(() => {});
    },
    [request]
  );

  const clear = useCallback(() => {
    request('clear').catch(() => {});
  }, [request]);

  return { video: state.video, serverNow, load, send, clear };
}
