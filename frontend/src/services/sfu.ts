/**
 * Voice through Cloudflare Realtime SFU (see the backend's Backend.Sfu):
 * one RTCPeerConnection to Cloudflare per participant, instead of one to
 * every other participant. We publish named tracks into our SFU session
 * ("audio", and "screen" while sharing) and pull the tracks the others in
 * the room announce in their Presence (`sfu_session`/`sfu_tracks`).
 *
 * Every API call goes through the voice channel (`signaling.request`),
 * which holds the app secret and checks that we only touch our own session
 * and only pull from people in the room.
 *
 * Negotiation steps run one at a time (`enqueue`): each changes the same
 * connection's SDP state, and two interleaved would corrupt it.
 */

export type SfuTrackName = 'audio' | 'screen';

export interface SfuSignaling {
  request<T>(event: string, payload?: Record<string, unknown>): Promise<T>;
}

export interface SfuCallbacks {
  onRemoteTrack(userId: string, trackName: string, track: MediaStreamTrack): void;
  onRemoteTrackRemoved(userId: string, trackName: string): void;
  onConnectionStateChange(state: RTCPeerConnectionState): void;
}

/** What the others in the room have published (from their Presence). */
export interface SfuPublisher {
  user_id: string;
  sfu_tracks?: string[] | null;
}

interface SessionDescriptionJSON {
  type: RTCSdpType;
  sdp: string;
}

interface TracksResponse {
  requiresImmediateRenegotiation?: boolean;
  sessionDescription?: SessionDescriptionJSON;
  tracks?: { mid?: string; trackName?: string; user_id?: string; errorCode?: string }[];
}

interface PulledTrack {
  userId: string;
  trackName: string;
  mid: string;
}

export const CLOUDFLARE_STUN: RTCIceServer = { urls: 'stun:stun.cloudflare.com:3478' };

const key = (userId: string, trackName: string) => `${userId}\u0000${trackName}`;

export class SfuConnection {
  private readonly pc: RTCPeerConnection;
  private queue: Promise<void> = Promise.resolve();
  private started = false;
  private closed = false;
  /** Tracks we pull, by `key()`; and the same, by the transceiver mid they arrive on. */
  private readonly pulled = new Map<string, PulledTrack>();
  private readonly pulledByMid = new Map<string, PulledTrack>();
  /** What the others have published, as of the last `sync()`. */
  private wanted = new Map<string, { userId: string; trackName: string }>();
  private screen: RTCRtpTransceiver | null = null;
  private readonly signaling: SfuSignaling;
  private readonly callbacks: SfuCallbacks;

  constructor(signaling: SfuSignaling, iceServers: RTCIceServer[], callbacks: SfuCallbacks) {
    this.signaling = signaling;
    this.callbacks = callbacks;
    this.pc = new RTCPeerConnection({
      iceServers: [CLOUDFLARE_STUN, ...iceServers],
      bundlePolicy: 'max-bundle',
    });

    this.pc.ontrack = (event) => {
      const mid = event.transceiver?.mid;
      const pulled = mid ? this.pulledByMid.get(mid) : undefined;
      if (pulled) callbacks.onRemoteTrack(pulled.userId, pulled.trackName, event.track);
    };
    this.pc.onconnectionstatechange = () => callbacks.onConnectionStateChange(this.pc.connectionState);
  }

  /** Creates our session and publishes the microphone. */
  start(audioTrack: MediaStreamTrack, stream: MediaStream): Promise<void> {
    return this.enqueue(async () => {
      await this.signaling.request('sfu_session');
      await this.publish(audioTrack, stream, 'audio');
      this.started = true;
      await this.reconcile();
    });
  }

  /** Brings what we pull in line with what the others in the room publish. */
  sync(publishers: SfuPublisher[]): Promise<void> {
    const wanted = new Map<string, { userId: string; trackName: string }>();
    for (const publisher of publishers) {
      for (const trackName of publisher.sfu_tracks ?? []) {
        wanted.set(key(publisher.user_id, trackName), { userId: publisher.user_id, trackName });
      }
    }
    this.wanted = wanted;
    return this.enqueue(() => this.reconcile());
  }

  publishScreen(track: MediaStreamTrack, stream: MediaStream): Promise<void> {
    return this.enqueue(async () => {
      if (this.screen) return;
      this.screen = await this.publish(track, stream, 'screen');
    });
  }

  unpublishScreen(): Promise<void> {
    return this.enqueue(async () => {
      const transceiver = this.screen;
      this.screen = null;
      if (!transceiver?.mid) return;
      await this.closeTransceivers([transceiver], ['screen']);
    });
  }

  close(): void {
    this.closed = true;
    this.pc.close();
  }

  private enqueue(step: () => Promise<void>): Promise<void> {
    const run = this.queue.then(() => (this.closed ? undefined : step()));
    // A failed step mustn't wedge the ones after it.
    this.queue = run.catch((err) => {
      console.warn('[voice-sfu]', err);
    });
    return run;
  }

  private async publish(
    track: MediaStreamTrack,
    stream: MediaStream,
    trackName: SfuTrackName
  ): Promise<RTCRtpTransceiver> {
    const transceiver = this.pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const response = await this.signaling.request<TracksResponse>('sfu_publish', {
      session_description: this.localDescription(),
      tracks: [{ mid: transceiver.mid, trackName }],
    });
    if (response.sessionDescription) await this.pc.setRemoteDescription(response.sessionDescription);
    return transceiver;
  }

  private async reconcile(): Promise<void> {
    if (!this.started) return;

    const toDrop = [...this.pulled.entries()].filter(([k]) => !this.wanted.has(k)).map(([, p]) => p);
    const toPull = [...this.wanted.entries()].filter(([k]) => !this.pulled.has(k)).map(([, w]) => w);

    if (toDrop.length > 0) await this.drop(toDrop);
    if (toPull.length > 0) await this.pull(toPull);
  }

  private async pull(tracks: { userId: string; trackName: string }[]): Promise<void> {
    const response = await this.signaling.request<TracksResponse>('sfu_pull', {
      tracks: tracks.map((t) => ({ user_id: t.userId, trackName: t.trackName })),
    });

    // Known before the SFU's offer is applied, so ontrack can tell whose
    // track arrived on which mid.
    for (const track of response.tracks ?? []) {
      if (track.errorCode || !track.mid || !track.user_id || !track.trackName) continue;
      const pulled = { userId: track.user_id, trackName: track.trackName, mid: track.mid };
      this.pulled.set(key(pulled.userId, pulled.trackName), pulled);
      this.pulledByMid.set(pulled.mid, pulled);
    }

    if (response.requiresImmediateRenegotiation && response.sessionDescription) {
      await this.pc.setRemoteDescription(response.sessionDescription);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this.signaling.request('sfu_renegotiate', { session_description: this.localDescription() });
    }
  }

  private async drop(tracks: PulledTrack[]): Promise<void> {
    for (const track of tracks) {
      this.pulled.delete(key(track.userId, track.trackName));
      this.pulledByMid.delete(track.mid);
      this.callbacks.onRemoteTrackRemoved(track.userId, track.trackName);
    }

    const transceivers = this.pc
      .getTransceivers()
      .filter((t) => t.mid !== null && tracks.some((track) => track.mid === t.mid));
    if (transceivers.length > 0) await this.closeTransceivers(transceivers, []);
  }

  private async closeTransceivers(transceivers: RTCRtpTransceiver[], unpublish: SfuTrackName[]) {
    const mids = transceivers.map((t) => t.mid);
    transceivers.forEach((t) => t.stop());
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const response = await this.signaling.request<TracksResponse>('sfu_close', {
      mids,
      session_description: this.localDescription(),
      unpublish,
    });
    if (response.sessionDescription) await this.pc.setRemoteDescription(response.sessionDescription);
  }

  private localDescription(): SessionDescriptionJSON {
    const description = this.pc.localDescription!;
    return { type: description.type, sdp: description.sdp };
  }
}
