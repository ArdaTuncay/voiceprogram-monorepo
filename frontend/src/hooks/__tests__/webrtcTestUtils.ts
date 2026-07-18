import { vi } from 'vitest';

/**
 * jsdom (this project's vitest `environment`) doesn't implement WebRTC, Web
 * Audio, or Media Capture at all — `RTCPeerConnection`, `MediaStream`,
 * `navigator.mediaDevices`, and `AudioContext` are all `undefined` there
 * (verified empirically, not assumed). `useVoiceChannel` touches every one
 * of them, so tests need fakes for all four, not just the WebRTC-sounding
 * ones.
 */

export class FakeMediaStreamTrack {
  readonly kind: 'audio' | 'video';
  enabled = true;
  onended: (() => void) | null = null;
  stop = vi.fn();

  constructor(kind: 'audio' | 'video' = 'audio') {
    this.kind = kind;
  }
}

export class FakeMediaStream {
  private readonly tracks: FakeMediaStreamTrack[];

  constructor(tracks: FakeMediaStreamTrack[] = [new FakeMediaStreamTrack('audio')]) {
    this.tracks = tracks;
  }

  getTracks(): FakeMediaStreamTrack[] {
    return this.tracks;
  }

  getAudioTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === 'audio');
  }

  getVideoTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === 'video');
  }
}

/** A one-audio-track fake stream, the shape every `getUserMedia` call in `useVoiceChannel` expects. */
export function makeFakeStream(): FakeMediaStream {
  return new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
}

/**
 * A controllable fake for `RTCPeerConnection` that never touches real
 * networking — `signalingState`/`connectionState` are plain public fields
 * a test can set directly, and every method is a spy returning
 * deterministic fake SDP rather than negotiating anything real.
 *
 * `useVoiceChannel` creates these itself (inside `createPeerConnection`),
 * so a test has no direct reference to the instance the hook is holding —
 * every construction is recorded in the static `instances` array (cleared
 * by `installWebrtcMocks()` each `beforeEach`) so a test can retrieve it
 * afterwards, e.g. `FakeRTCPeerConnection.instances[0]`, and drive its
 * `signalingState`/mock return values directly before triggering the
 * hook's `onOffer`/`onconnectionstatechange` handlers.
 *
 * NOT concurrency-safe: `instances` is shared, module-level, mutable state,
 * reset in `beforeEach` and read positionally (`instances[0]`, `[1]`, ...)
 * by whichever test is currently running. This only works because tests
 * run one at a time — callers must use `describe.sequential` (see
 * useVoiceChannel.test.ts) and never mark a test in that suite
 * `.concurrent`, or two tests' instances will interleave and `instances[0]`
 * will silently pick up the wrong connection.
 */
export class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];

  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  addTrack = vi.fn();
  createOffer = vi.fn(
    async (): Promise<RTCSessionDescriptionInit> => ({ type: 'offer', sdp: 'fake-offer-sdp' })
  );
  createAnswer = vi.fn(
    async (): Promise<RTCSessionDescriptionInit> => ({ type: 'answer', sdp: 'fake-answer-sdp' })
  );
  // Typed with their real parameter (unused at runtime) so `.mock.calls[n][0]`
  // type-checks for tests that inspect exactly what was passed in — e.g.
  // distinguishing a `{ type: 'rollback' }` call from a real offer/answer.
  setLocalDescription = vi.fn(async (_description?: RTCLocalSessionDescriptionInit) => {});
  setRemoteDescription = vi.fn(async (_description?: RTCSessionDescriptionInit) => {});
  addIceCandidate = vi.fn(async () => {});
  restartIce = vi.fn();
  close = vi.fn(() => {
    this.connectionState = 'closed';
  });

  constructor() {
    FakeRTCPeerConnection.instances.push(this);
  }
}

/** Minimal value-holder fakes — `useVoiceChannel` only ever reads `.type`/`.sdp`/`.candidate` back off these. */
class FakeRTCSessionDescription {
  type: RTCSdpType;
  sdp: string;

  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type;
    this.sdp = init.sdp ?? '';
  }
}

class FakeRTCIceCandidate {
  candidate: string;

  constructor(init: RTCIceCandidateInit) {
    this.candidate = init.candidate ?? '';
    Object.assign(this, init);
  }
}

class FakeAnalyserNode {
  fftSize = 2048;
  frequencyBinCount = 1024;
  getByteFrequencyData = vi.fn();
}

class FakeAudioContext {
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createAnalyser = vi.fn(() => new FakeAnalyserNode());
  close = vi.fn(async () => {});
}

/**
 * Installs the jsdom-missing globals `useVoiceChannel` touches. Call from
 * `beforeEach` so every test gets fresh spies; pair with `vi.unstubAllGlobals()`
 * in `afterEach`. Returns the `getUserMedia` spy directly (rather than
 * relying on `vi.mocked(navigator.mediaDevices.getUserMedia)`) since
 * `navigator.mediaDevices` doesn't exist beforehand for that to type-check
 * against.
 */
export function installWebrtcMocks(): {
  getUserMedia: ReturnType<typeof vi.fn>;
  getDisplayMedia: ReturnType<typeof vi.fn>;
} {
  FakeRTCPeerConnection.instances = [];

  vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection);
  vi.stubGlobal('RTCSessionDescription', FakeRTCSessionDescription);
  vi.stubGlobal('RTCIceCandidate', FakeRTCIceCandidate);
  vi.stubGlobal('AudioContext', FakeAudioContext);

  const getUserMedia = vi.fn();
  const getDisplayMedia = vi.fn();

  // `navigator.mediaDevices` isn't a plain undefined own-property in jsdom
  // (assigning over it directly is unreliable), so replace it the same way
  // `vi.stubGlobal` would for a top-level global.
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, getDisplayMedia },
  });

  return { getUserMedia, getDisplayMedia };
}

/** A promise a test can resolve/reject from the outside, on its own schedule. */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
