import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SfuConnection } from '../sfu';
import type { SfuCallbacks } from '../sfu';

/** Just enough of RTCPeerConnection: transceivers get mids "0", "1", ...
 * when a local description is set, as a browser assigns them; the SFU's
 * offers create receiving transceivers on the mids it names. */
class FakePeerConnection {
  static last: FakePeerConnection;
  config: RTCConfiguration;
  transceivers: { mid: string | null; stopped: boolean; stop: () => void; kind?: string }[] = [];
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescriptions: RTCSessionDescriptionInit[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  ontrack: ((event: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  closed = false;
  private nextMid = 0;
  /** Mids the next remote offer brings (set by the fake signaling). */
  incomingMids: string[] = [];

  constructor(config: RTCConfiguration) {
    this.config = config;
    FakePeerConnection.last = this;
  }

  addTransceiver() {
    const t = {
      mid: null as string | null,
      stopped: false,
      stop() {
        this.stopped = true;
      },
    };
    this.transceivers.push(t);
    return t;
  }

  getTransceivers() {
    return this.transceivers;
  }

  async createOffer() {
    return { type: 'offer' as const, sdp: `offer-${this.transceivers.length}` };
  }

  async createAnswer() {
    return { type: 'answer' as const, sdp: 'answer' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    for (const t of this.transceivers) if (t.mid === null) t.mid = String(this.nextMid++);
    this.localDescription = description;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescriptions.push(description);
    if (description.type === 'offer') {
      for (const mid of this.incomingMids) {
        const transceiver = { mid, stopped: false, stop() {} };
        this.transceivers.push(transceiver);
        this.ontrack?.({ transceiver, track: { id: `track-${mid}` } });
      }
      this.incomingMids = [];
    }
  }

  close() {
    this.closed = true;
  }
}

function fakeSignaling() {
  const calls: { event: string; payload?: Record<string, unknown> }[] = [];
  let nextMid = 10;

  const request = vi.fn(async (event: string, payload?: Record<string, unknown>) => {
    calls.push({ event, payload });
    switch (event) {
      case 'sfu_session':
        return { session_id: 'mine' };
      case 'sfu_publish':
      case 'sfu_close':
        return { sessionDescription: { type: 'answer', sdp: `${event}-answer` } };
      case 'sfu_pull': {
        const tracks = (payload!.tracks as { user_id: string; trackName: string }[]).map((t) => ({
          ...t,
          mid: String(nextMid++),
        }));
        FakePeerConnection.last.incomingMids = tracks.map((t) => t.mid);
        return {
          requiresImmediateRenegotiation: true,
          sessionDescription: { type: 'offer', sdp: 'sfu-offer' },
          tracks,
        };
      }
      default:
        return {};
    }
  });

  return { calls, signaling: { request } as never };
}

function callbacks(): SfuCallbacks & { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  return {
    added,
    removed,
    onRemoteTrack: (userId, trackName) => added.push(`${userId}/${trackName}`),
    onRemoteTrackRemoved: (userId, trackName) => removed.push(`${userId}/${trackName}`),
    onConnectionStateChange: vi.fn(),
  };
}

const mic = { kind: 'audio' } as MediaStreamTrack;
const stream = {} as MediaStream;

beforeEach(() => {
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SfuConnection', () => {
  it('opens a session and publishes the microphone as "audio", via Cloudflare STUN', async () => {
    const { calls, signaling } = fakeSignaling();
    const sfu = new SfuConnection(signaling, [{ urls: 'turn:x' }], callbacks());

    await sfu.start(mic, stream);

    expect(FakePeerConnection.last.config.iceServers?.[0]).toEqual({ urls: 'stun:stun.cloudflare.com:3478' });
    expect(calls.map((c) => c.event)).toEqual(['sfu_session', 'sfu_publish']);
    expect(calls[1].payload).toEqual({
      session_description: { type: 'offer', sdp: 'offer-1' },
      tracks: [{ mid: '0', trackName: 'audio' }],
    });
    expect(FakePeerConnection.last.remoteDescriptions).toEqual([{ type: 'answer', sdp: 'sfu_publish-answer' }]);
  });

  it('pulls what the others publish, answers the SFU, and says whose track arrived', async () => {
    const { calls, signaling } = fakeSignaling();
    const cb = callbacks();
    const sfu = new SfuConnection(signaling, [], cb);

    // Presence can arrive before our own session is up — nothing is pulled
    // until it is.
    const synced = sfu.sync([{ user_id: 'ayse', sfu_tracks: ['audio'] }]);
    await sfu.start(mic, stream);
    await synced;

    const pull = calls.find((c) => c.event === 'sfu_pull');
    expect(pull?.payload).toEqual({ tracks: [{ user_id: 'ayse', trackName: 'audio' }] });
    expect(calls.at(-1)).toEqual({
      event: 'sfu_renegotiate',
      payload: { session_description: { type: 'answer', sdp: 'answer' } },
    });
    expect(cb.added).toEqual(['ayse/audio']);

    // Same presence again: nothing new to pull.
    await sfu.sync([{ user_id: 'ayse', sfu_tracks: ['audio'] }]);
    expect(calls.filter((c) => c.event === 'sfu_pull')).toHaveLength(1);
  });

  it('closes the tracks of someone who stopped sharing or left', async () => {
    const { calls, signaling } = fakeSignaling();
    const cb = callbacks();
    const sfu = new SfuConnection(signaling, [], cb);
    await sfu.start(mic, stream);
    await sfu.sync([{ user_id: 'ayse', sfu_tracks: ['audio', 'screen'] }]);

    await sfu.sync([{ user_id: 'ayse', sfu_tracks: ['audio'] }]);
    expect(cb.removed).toEqual(['ayse/screen']);
    expect(calls.at(-1)).toMatchObject({ event: 'sfu_close', payload: { mids: ['11'], unpublish: [] } });

    await sfu.sync([]);
    expect(cb.removed).toEqual(['ayse/screen', 'ayse/audio']);
    expect(calls.at(-1)).toMatchObject({ event: 'sfu_close', payload: { mids: ['10'] } });
  });

  it('publishes and unpublishes the screen as "screen"', async () => {
    const { calls, signaling } = fakeSignaling();
    const sfu = new SfuConnection(signaling, [], callbacks());
    await sfu.start(mic, stream);

    await sfu.publishScreen({ kind: 'video' } as MediaStreamTrack, stream);
    expect(calls.at(-1)).toMatchObject({ event: 'sfu_publish', payload: { tracks: [{ mid: '1', trackName: 'screen' }] } });

    await sfu.unpublishScreen();
    expect(calls.at(-1)).toMatchObject({ event: 'sfu_close', payload: { mids: ['1'], unpublish: ['screen'] } });
    expect(FakePeerConnection.last.transceivers[1].stopped).toBe(true);
  });

  it('can start over in a fresh session, and says which session it is in', async () => {
    const { calls, signaling } = fakeSignaling();
    const sfu = new SfuConnection(signaling, [], callbacks());
    expect(sfu.sessionId).toBeNull();

    await sfu.start(mic, stream, { renew: true });

    expect(calls[0]).toEqual({ event: 'sfu_session', payload: { renew: true } });
    expect(sfu.sessionId).toBe('mine');
  });

  it("pulls someone's tracks again when they come back in a new session", async () => {
    const { calls, signaling } = fakeSignaling();
    const cb = callbacks();
    const sfu = new SfuConnection(signaling, [], cb);
    await sfu.start(mic, stream);
    await sfu.sync([{ user_id: 'ayse', sfu_session: 'old', sfu_tracks: ['audio'] }]);

    await sfu.sync([{ user_id: 'ayse', sfu_session: 'new', sfu_tracks: ['audio'] }]);

    expect(cb.removed).toEqual(['ayse/audio']);
    expect(cb.added).toEqual(['ayse/audio', 'ayse/audio']);
    expect(calls.map((c) => c.event).slice(-3)).toEqual(['sfu_close', 'sfu_pull', 'sfu_renegotiate']);
  });

  it('keeps going after a failed step, and does nothing once closed', async () => {
    const { calls, signaling } = fakeSignaling();
    const sfu = new SfuConnection(signaling, [], callbacks());
    const request = (signaling as { request: ReturnType<typeof vi.fn> }).request;
    request.mockRejectedValueOnce(new Error('sfu_error'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(sfu.start(mic, stream)).rejects.toThrow('sfu_error');
    await sfu.start(mic, stream);
    expect(calls.map((c) => c.event)).toEqual(['sfu_session', 'sfu_publish']);

    sfu.close();
    await sfu.sync([{ user_id: 'ayse', sfu_tracks: ['audio'] }]);
    expect(FakePeerConnection.last.closed).toBe(true);
    expect(calls.some((c) => c.event === 'sfu_pull')).toBe(false);
  });
});
