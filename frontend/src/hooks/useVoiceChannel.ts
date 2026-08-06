import { useCallback, useRef, useState } from 'react';
import type { User, PresenceUser, VoiceSignalPayload } from '../types';
import {
  joinVoiceChannel,
  sendVoiceOffer,
  sendVoiceAnswer,
  sendIceCandidate,
  sendVoiceStatus,
  sendIceDiagnostics,
} from '../services/socket';
import { fetchTurnCredentials } from '../services/api';
import { resolveMicConstraint } from '../services/mediaPreferences';

// How long to wait on a VITE_TURN_API_URL fetch before giving up on it and
// falling back to the static/STUN-only config — a hung managed-TURN-provider
// request shouldn't block voice channel setup indefinitely.
const ICE_SERVERS_FETCH_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('TURN API isteği zaman aşımına uğradı')), ms);
    }),
  ]);
}

/**
 * Fetches ICE server credentials from a managed TURN provider's HTTP API.
 * Accepts either a bare array response (e.g. Metered.ca's
 * `/api/v1/turn/credentials`) or `{ iceServers: [...] }` (e.g. a backend
 * proxy in front of Xirsys, whose own API needs a server-side-only secret
 * so can't be called directly from the client).
 */
async function fetchDynamicIceServers(apiUrl: string): Promise<RTCIceServer[]> {
  const response = await fetch(apiUrl);
  if (!response.ok) throw new Error(`TURN API ${response.status}`);

  const data: unknown = await response.json();
  const raw = Array.isArray(data) ? data : (data as { iceServers?: unknown })?.iceServers;
  if (!Array.isArray(raw)) throw new Error('Beklenmeyen TURN API yanıt biçimi');

  return raw as RTCIceServer[];
}

/**
 * Builds the ICE server list from a single static TURN server configured
 * via env vars (all three must be set together; see vite-env.d.ts) — the
 * shape a self-hosted relay like coturn uses, since its credentials don't
 * expire and there's nothing to fetch.
 */
function buildStaticIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnPassword = import.meta.env.VITE_TURN_PASSWORD;

  if (turnUrl && turnUsername && turnPassword) {
    // e.g. VITE_TURN_URL="turn:your-turn-server.com:3478"
    servers.push({ urls: turnUrl, username: turnUsername, credential: turnPassword });
  }

  return servers;
}

/**
 * Resolves the ICE server list to hand every `RTCPeerConnection` — Google's
 * public STUN server always, plus a TURN relay when one is configured.
 * STUN alone only helps two peers discover their public address and works
 * fine on an open network/same LAN (today's dev/testing setup) — it does
 * nothing for peers behind a symmetric NAT or a restrictive corporate
 * firewall, which silently drop the connection instead. A TURN server
 * relays media through itself as a fallback for exactly that case.
 *
 * Prefers `VITE_TURN_API_URL` (a managed provider like Metered.ca/Xirsys
 * handing out fresh, normally short-lived credentials) when set, falling
 * back to the static single-server config, and finally to STUN-only if
 * neither is configured or the API fetch fails/times out.
 */
async function resolveIceServers(): Promise<RTCIceServer[]> {
  const apiUrl = import.meta.env.VITE_TURN_API_URL;

  if (apiUrl) {
    try {
      const servers = await withTimeout(fetchDynamicIceServers(apiUrl), ICE_SERVERS_FETCH_TIMEOUT_MS);
      if (servers.length > 0) return servers;
    } catch (err) {
      console.warn('TURN API\'sinden ICE sunucuları alınamadı, statik yapılandırmaya dönülüyor:', err);
    }
  }

  return buildStaticIceServers();
}

/**
 * Our own backend's proxied Metered.ca TURN credentials (see
 * BackendWeb.VoiceController / Backend.Turn, PROJECT_ARCHITECTURE.md
 * 2.9) — the Metered API key never reaches the frontend this way, unlike
 * `VITE_TURN_API_URL`/the static `VITE_TURN_*` vars above. Always
 * additive to whatever `resolveIceServers()` already resolves (see
 * `getIceServers()` below) — never replaces the static STUN entry.
 * Silently returns `[]` on any failure (network error, 401, backend has
 * no Metered key configured, ...) so a proxy outage/misconfiguration
 * never blocks joining a voice channel — same STUN-only-degrades-
 * gracefully philosophy as every other ICE server source here.
 */
async function fetchBackendTurnServers(): Promise<RTCIceServer[]> {
  try {
    const { data } = await fetchTurnCredentials();
    return data?.ice_servers ?? [];
  } catch {
    return [];
  }
}

// Resolved once and cached — every peer connection in this tab shares the
// same TURN credentials rather than each triggering its own API round trip.
let iceServersPromise: Promise<RTCIceServer[]> | null = null;

function getIceServers(): Promise<RTCIceServer[]> {
  if (!iceServersPromise) {
    iceServersPromise = Promise.all([resolveIceServers(), fetchBackendTurnServers()]).then(
      ([configured, backendTurn]) => [...configured, ...backendTurn]
    );
  }
  return iceServersPromise;
}

/** Test-only: clears the module-level cache above so each test can
 * control fetchBackendTurnServers'/resolveIceServers' resolved value
 * independently, instead of whichever test runs first in a given
 * process permanently deciding it for every test after. Exported the
 * same way ICE_DISCONNECT_GRACE_MS/GLARE_RECOVERY_DELAY_MS below already
 * are — a small, deliberate test seam, not something app code calls. */
export function resetIceServersCacheForTests(): void {
  iceServersPromise = null;
}

// Volume (0-255) above which a stream counts as "speaking", and how long
// the speaking indicator is held after the last loud sample (avoids flicker).
const SPEAKING_THRESHOLD = 12;
const SPEAKING_HOLD_MS = 300;

// How long to wait after a peer connection reports "disconnected" before
// actually attempting an ICE restart. "disconnected" is often a transient
// blip (WebRTC's own ICE keepalive briefly missing a beat) that recovers on
// its own within a few seconds — restarting immediately on every such blip
// would renegotiate far more than necessary. "failed" skips this grace
// period entirely since the browser has already given up on the current
// candidates.
export const ICE_DISCONNECT_GRACE_MS = 3000;

// How long to wait before retrying an ICE restart after an offer/offer
// glare collision that setRemoteDescription/rollback couldn't cleanly
// resolve — gives the browser a moment to settle the connection's
// signaling state rather than immediately retrying into the same failure.
export const GLARE_RECOVERY_DELAY_MS = 1000;

interface AnalyserHandle {
  ctx: AudioContext;
  raf: number;
}

/**
 * Diagnostic-only: identifies which ICE candidate type (host/srflx/prflx/
 * relay) a peer connection actually ended up using, and reports it (see
 * PROJECT_ARCHITECTURE.md's WebRTC section for why — deciding whether a
 * managed TURN server is worth setting up needs real-user data on how
 * often `relay` is actually the one that works, not just local/dev
 * testing where a direct `host` path always succeeds). Called exactly
 * once per peer connection per outcome — from `onconnectionstatechange`'s
 * `'connected'`/`'failed'` cases, never polled — so this is a single
 * `getStats()` snapshot, not a running log.
 *
 * Finds the actually-selected pair via the `candidate-pair` stats report
 * with `nominated: true` (see MDN's RTCPeerConnection.getStats()), then
 * looks up that pair's `local-candidate` report for its `candidateType`.
 * On `'failed'`, no pair may ever have been nominated at all — logged as
 * `candidateType: null` ("none"), which is itself useful signal (ICE
 * couldn't even select a path to try).
 *
 * Deliberately reads only `candidateType` off the local-candidate report,
 * never `address`/`ip`/`port`/`relatedAddress` (a peer's real IP, or a
 * TURN relay's) — this only ever needs to know *which kind* of path was
 * used, not *where* it went, so nothing PII-shaped is ever read out of
 * the stats in the first place, let alone logged or sent anywhere.
 */
// TypeScript's lib.dom.d.ts has no dedicated interface for a
// 'local-candidate'/'remote-candidate' stats report (unlike
// RTCIceCandidatePairStats, which it does define) — this covers the one
// field this needs off it.
interface IceCandidateStatsReport {
  candidateType?: RTCIceCandidateType;
}

async function logIceOutcome(
  peerId: string,
  pc: RTCPeerConnection,
  outcome: 'connected' | 'failed'
) {
  let candidateType: RTCIceCandidateType | null = null;

  try {
    const stats = await pc.getStats();

    for (const report of stats.values()) {
      if (report.type === 'candidate-pair' && (report as RTCIceCandidatePairStats).nominated) {
        const localCandidateId = (report as RTCIceCandidatePairStats).localCandidateId;
        const localCandidate = localCandidateId
          ? (stats.get(localCandidateId) as IceCandidateStatsReport | undefined)
          : undefined;
        candidateType = localCandidate?.candidateType ?? null;
        break;
      }
    }
  } catch {
    // getStats() itself failing shouldn't crash the connection-state
    // handler that calls this — this is best-effort diagnostics, nothing
    // downstream depends on it succeeding.
  }

  // No Sentry (or any other error/telemetry SDK) is installed on the
  // frontend (checked before adding this) — console.info is the only
  // local signal available. sendIceDiagnostics below is what actually
  // makes this reach anywhere aggregatable across real users (see
  // BackendWeb.VoiceChannel's "report_ice_stats" handler, which just
  // Logger.infos it — no new DB table/analytics pipeline for this).
  console.info(
    `[voice-ice] peer=${peerId} candidateType=${candidateType ?? 'none'} connectionState=${outcome}`
  );

  sendIceDiagnostics(candidateType, outcome);
}

export function useVoiceChannel(user: User) {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<PresenceUser[]>([]);
  const [speakingUserIds, setSpeakingUserIds] = useState<Set<string>>(new Set());
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [screenShares, setScreenShares] = useState<Record<string, MediaStream>>({});
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [reconnectingPeerIds, setReconnectingPeerIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const leaveVoiceRef = useRef<(() => void) | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const analysersRef = useRef<Map<string, AnalyserHandle>>(new Map());
  const knownPeerIdsRef = useRef<Set<string>>(new Set());
  const reconnectTimersRef = useRef<Map<string, number>>(new Map());
  // Bumped by every leave() (including the one join() always starts with —
  // see both below) — lets an in-flight join() recognize, after each
  // await, that it's been superseded (a *different* join() started, the
  // active room disappeared, the hook unmounted, ...) and bail out instead
  // of clobbering newer state or leaking this attempt's own mic stream/
  // channel/analyser.
  const joinGenerationRef = useRef(0);

  // Test-only visibility hook for Playwright E2E tests (see
  // e2e/voice-channel.spec.ts) — this hook's return value only exposes
  // derived state (remoteStreams, participants, ...), never the real
  // RTCPeerConnection objects, so there's no other way for a test running
  // outside React to observe an actual connectionState transition (e.g.
  // confirming 'connected' really happens, not just that the UI eventually
  // shows a peer). Doesn't change any behavior — peersRef.current is the
  // same Map either way, this only publishes the reference. DEV-only:
  // import.meta.env.DEV is statically false in a production build, so Vite
  // dead-code-eliminates this whole block — no runtime cost or exposure
  // outside local dev/test.
  if (import.meta.env.DEV) {
    (window as unknown as { __e2eVoicePeers?: Map<string, RTCPeerConnection> }).__e2eVoicePeers =
      peersRef.current;
  }

  const setSpeaking = useCallback((id: string, speaking: boolean) => {
    setSpeakingUserIds((prev) => {
      if (speaking === prev.has(id)) return prev;
      const next = new Set(prev);
      if (speaking) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const watchSpeaking = useCallback(
    (id: string, stream: MediaStream) => {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      let lastLoudAt = 0;
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
        const now = performance.now();
        if (avg > SPEAKING_THRESHOLD) {
          lastLoudAt = now;
          setSpeaking(id, true);
        } else if (now - lastLoudAt > SPEAKING_HOLD_MS) {
          setSpeaking(id, false);
        }
        handle.raf = requestAnimationFrame(tick);
      };
      const handle: AnalyserHandle = { ctx, raf: requestAnimationFrame(tick) };
      analysersRef.current.set(id, handle);
    },
    [setSpeaking]
  );

  const stopWatchingSpeaking = useCallback(
    (id: string) => {
      const handle = analysersRef.current.get(id);
      if (handle) {
        cancelAnimationFrame(handle.raf);
        void handle.ctx.close();
        analysersRef.current.delete(id);
      }
      setSpeaking(id, false);
    },
    [setSpeaking]
  );

  const setReconnecting = useCallback((peerId: string, reconnecting: boolean) => {
    setReconnectingPeerIds((prev) => {
      if (reconnecting === prev.has(peerId)) return prev;
      const next = new Set(prev);
      if (reconnecting) next.add(peerId);
      else next.delete(peerId);
      return next;
    });
  }, []);

  function clearReconnectTimer(peerId: string) {
    const timer = reconnectTimersRef.current.get(peerId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      reconnectTimersRef.current.delete(peerId);
    }
  }

  function flushPendingCandidates(peerId: string, pc: RTCPeerConnection) {
    const queued = pendingCandidatesRef.current.get(peerId);
    if (!queued) return;
    queued.forEach((c) => {
      void pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    });
    pendingCandidatesRef.current.delete(peerId);
  }

  const closePeer = useCallback(
    (peerId: string) => {
      peersRef.current.get(peerId)?.close();
      peersRef.current.delete(peerId);
      pendingCandidatesRef.current.delete(peerId);
      clearReconnectTimer(peerId);
      setReconnecting(peerId, false);
      stopWatchingSpeaking(peerId);
      setRemoteStreams((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      setScreenShares((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    },
    [stopWatchingSpeaking, setReconnecting]
  );

  async function createPeerConnection(peerId: string): Promise<RTCPeerConnection> {
    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });

    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });

    // If we're already screen-sharing when this connection is created (e.g.
    // a new peer joins the room, or we're answering someone we haven't
    // connected to yet), include the share from the start.
    screenStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, screenStreamRef.current!);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendIceCandidate({ from: user.id, to: peerId, candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (event.track.kind === 'video') {
        setScreenShares((prev) => ({ ...prev, [peerId]: stream }));
        event.track.onended = () => {
          setScreenShares((prev) => {
            if (!(peerId in prev)) return prev;
            const next = { ...prev };
            delete next[peerId];
            return next;
          });
        };
      } else {
        setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
        watchSpeaking(peerId, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'disconnected':
          // Often transient — give it ICE_DISCONNECT_GRACE_MS to recover on
          // its own (re-checking connectionState when the timer fires,
          // since it may have already reconnected or moved on to 'failed'/
          // 'closed' by then) before actually restarting ICE.
          setReconnecting(peerId, true);
          clearReconnectTimer(peerId);
          reconnectTimersRef.current.set(
            peerId,
            window.setTimeout(() => {
              reconnectTimersRef.current.delete(peerId);
              if (pc.connectionState === 'disconnected') void restartIceForPeer(peerId, pc);
            }, ICE_DISCONNECT_GRACE_MS)
          );
          break;

        case 'failed':
          // The browser has already given up on the current candidates —
          // no point waiting, restart ICE right away.
          setReconnecting(peerId, true);
          clearReconnectTimer(peerId);
          void restartIceForPeer(peerId, pc);
          void logIceOutcome(peerId, pc, 'failed');
          break;

        case 'connected':
          clearReconnectTimer(peerId);
          setReconnecting(peerId, false);
          void logIceOutcome(peerId, pc, 'connected');
          break;

        case 'closed':
          closePeer(peerId);
          break;
      }
    };

    peersRef.current.set(peerId, pc);
    return pc;
  }

  /** Reuses an existing connection to a peer if we have one (renegotiation), else creates one. */
  async function getOrCreatePeerConnection(peerId: string): Promise<RTCPeerConnection> {
    return peersRef.current.get(peerId) ?? (await createPeerConnection(peerId));
  }

  async function callPeer(peerId: string) {
    const pc = await createPeerConnection(peerId);
    await renegotiateWithPeer(peerId, pc);
  }

  /** Creates a fresh offer for an already-connected peer and sends it — the
   * shared renegotiation step used both when screen sharing starts (one
   * loop iteration per already-connected peer, see startScreenShare) and
   * when answering a newcomer/rejoiner whose own offer had no video m-line
   * to negotiate an active screen share against (see handleOffer below). */
  async function renegotiateWithPeer(peerId: string, pc: RTCPeerConnection) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendVoiceOffer({ from: user.id, to: peerId, sdp: offer });
  }

  /**
   * Attempts to recover a degraded connection in place: tells the ICE agent
   * to gather fresh candidates (`restartIce`) and sends a renegotiation
   * offer with `iceRestart: true` over the existing signaling channel — the
   * peer's own `handleOffer` already reuses its current connection for any
   * incoming offer (see `getOrCreatePeerConnection`), so nothing needs to
   * change on the receiving side for this to work.
   *
   * If both sides detect the same failure at once and both restart
   * simultaneously, the resulting offer/offer glare is resolved by
   * `handleOffer`'s polite/impolite tie-break (see below) rather than here.
   */
  async function restartIceForPeer(peerId: string, pc: RTCPeerConnection) {
    try {
      pc.restartIce();
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      sendVoiceOffer({ from: user.id, to: peerId, sdp: offer });
    } catch {
      // Renegotiation itself failed (e.g. the connection is already closed
      // by the time this runs) — don't leave it stuck in "reconnecting"
      // forever, just tear it down like a hard failure would have.
      closePeer(peerId);
    }
  }

  async function handleOffer(payload: VoiceSignalPayload) {
    if (payload.to !== user.id || !payload.sdp) return;
    // Reuse the existing connection when this is a renegotiation (e.g. a
    // peer just started or stopped screen sharing) rather than replacing it.
    const pc = await getOrCreatePeerConnection(payload.from);

    // Glare: both sides sent an offer at once (typically both restarting
    // ICE for the same degraded connection). setRemoteDescription would
    // throw InvalidStateError here since we already have a local offer
    // pending. Resolve the tie the same way perfect negotiation does —
    // by comparing peer ids — instead of letting the error lock the
    // connection up: the lexicographically larger id is "impolite" and
    // keeps its own offer (the other side's incoming offer is dropped,
    // since that peer will symmetrically accept ours), while the smaller
    // id is "polite" and rolls its own offer back to accept the incoming
    // one.
    const isGlare = pc.signalingState === 'have-local-offer';
    const isImpolite = user.id > payload.from;

    if (isGlare && isImpolite) return;

    try {
      if (isGlare) {
        await pc.setLocalDescription({ type: 'rollback' });
      }
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    } catch {
      // Rollback couldn't cleanly resolve the collision (or some other
      // InvalidStateError) — don't leave the connection wedged in a bad
      // signaling state, just kick off a fresh ICE restart shortly after
      // instead of answering this offer.
      window.setTimeout(() => {
        const current = peersRef.current.get(payload.from);
        if (current) void restartIceForPeer(payload.from, current);
      }, GLARE_RECOVERY_DELAY_MS);
      return;
    }

    flushPendingCandidates(payload.from, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendVoiceAnswer({ from: user.id, to: payload.from, sdp: answer });

    // The offer we just answered only describes what payload.from is
    // sending — if we're screen-sharing and their offer had no video
    // m-line (e.g. they're a newcomer or a peer rejoining after leaving,
    // neither of whom is sharing themselves), JSEP means our answer
    // couldn't include our screen video either, even though
    // createPeerConnection already added it as a local track on this
    // connection. Detect that — the track's transceiver has no `mid`,
    // i.e. it was never actually included in a completed offer/answer
    // round — and follow up with a second, video-carrying offer: the same
    // per-peer renegotiation startScreenShare does for peers already
    // connected when sharing starts. Harmless/no-op once this connection's
    // video *has* been negotiated (mid is then non-null), so a later
    // renegotiation offer from the same peer (e.g. an ICE restart) won't
    // re-trigger this. Any resulting offer/offer glare is resolved by this
    // same handleOffer's polite/impolite tie-break above — that logic only
    // looks at signalingState, not why we ended up with a pending local
    // offer, so it already covers this path too.
    const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
    if (screenTrack) {
      const transceiver = pc.getTransceivers().find((t) => t.sender.track === screenTrack);
      if (transceiver && transceiver.mid === null) {
        void renegotiateWithPeer(payload.from, pc);
      }
    }
  }

  async function handleAnswer(payload: VoiceSignalPayload) {
    if (payload.to !== user.id || !payload.sdp) return;
    const pc = peersRef.current.get(payload.from);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    flushPendingCandidates(payload.from, pc);
  }

  async function handleIceCandidate(payload: VoiceSignalPayload) {
    if (payload.to !== user.id || !payload.candidate) return;
    const pc = peersRef.current.get(payload.from);
    if (!pc || !pc.remoteDescription) {
      const queue = pendingCandidatesRef.current.get(payload.from) ?? [];
      queue.push(payload.candidate);
      pendingCandidatesRef.current.set(payload.from, queue);
      return;
    }
    await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
  }

  /** Stops sharing the screen and tells every connected peer to drop the video track. */
  async function stopScreenShare() {
    const stream = screenStreamRef.current;
    if (!stream) return;

    const [videoTrack] = stream.getVideoTracks();

    await Promise.all(
      Array.from(peersRef.current.entries()).map(async ([peerId, pc]) => {
        const sender = pc.getSenders().find((s) => s.track === videoTrack);
        if (!sender) return;
        pc.removeTrack(sender);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendVoiceOffer({ from: user.id, to: peerId, sdp: offer });
      })
    );

    stream.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;

    setScreenShares((prev) => {
      if (!(user.id in prev)) return prev;
      const next = { ...prev };
      delete next[user.id];
      return next;
    });
    setIsScreenSharing(false);
  }

  /** Starts sharing the screen and renegotiates with every connected peer to add the video track. */
  async function startScreenShare() {
    if (!activeRoomId || screenStreamRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const [videoTrack] = stream.getVideoTracks();

      screenStreamRef.current = stream;
      setScreenShares((prev) => ({ ...prev, [user.id]: stream }));
      setIsScreenSharing(true);

      // Fires when the user stops sharing via the browser's own UI
      // (e.g. the "Stop sharing" bar) rather than our button.
      videoTrack.onended = () => void stopScreenShare();

      await Promise.all(
        Array.from(peersRef.current.entries()).map(([peerId, pc]) => {
          pc.addTrack(videoTrack, stream);
          return renegotiateWithPeer(peerId, pc);
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ekran paylaşımı başlatılamadı');
    }
  }

  /** Toggles the local microphone. Independent of deafen. */
  function toggleMute() {
    const next = !isMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setIsMuted(next);
    sendVoiceStatus(next, isDeafened);
  }

  /**
   * Toggles deafening (incoming audio is silenced by muting the <audio>
   * elements in Chat.tsx). Mirrors Discord: turning deafen on also mutes
   * the mic (no point transmitting if you can't hear anyone), but turning
   * it back off leaves the mute state untouched.
   */
  function toggleDeafen() {
    const next = !isDeafened;
    setIsDeafened(next);

    if (next && !isMuted) {
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      setIsMuted(true);
      sendVoiceStatus(true, true);
    } else {
      sendVoiceStatus(isMuted, next);
    }
  }

  const leave = useCallback(() => {
    // Bumped here (not just at the start of join()) so *any* leave —
    // whether from starting a different join(), the active room
    // disappearing out from under us, or unmounting — invalidates whatever
    // join() call might still be in flight, not just a newer join().
    joinGenerationRef.current += 1;

    leaveVoiceRef.current?.();
    leaveVoiceRef.current = null;

    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();

    reconnectTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    reconnectTimersRef.current.clear();

    Array.from(analysersRef.current.keys()).forEach(stopWatchingSpeaking);

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;

    knownPeerIdsRef.current = new Set();
    setActiveRoomId(null);
    setParticipants([]);
    setRemoteStreams({});
    setScreenShares({});
    setIsScreenSharing(false);
    setSpeakingUserIds(new Set());
    setReconnectingPeerIds(new Set());
    setIsMuted(false);
    setIsDeafened(false);
  }, [stopWatchingSpeaking]);

  async function join(roomId: string) {
    // leave() itself bumps joinGenerationRef (see above) — capturing the
    // generation right after means "this join" and "whatever the most
    // recent leave() just invalidated" can never collide.
    leave();
    const myGeneration = joinGenerationRef.current;
    setError('');

    let stream: MediaStream | null = null;

    try {
      const micConstraint = await resolveMicConstraint();

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraint });
      } catch (err) {
        // The saved device passed resolveMicConstraint's enumerateDevices
        // check but vanished (unplugged, permission revoked, ...) in the
        // moment between that check and this call — narrower than, but the
        // same "never let a stale device id block joining" fallback as,
        // resolveMicConstraint's own check. Only retried for that specific
        // failure; a plain permission denial should still surface as
        // itself rather than being masked by a silent retry.
        const isStaleDevice =
          micConstraint !== true && err instanceof Error && err.name === 'OverconstrainedError';
        if (!isStaleDevice) throw err;
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      if (joinGenerationRef.current !== myGeneration) {
        // Superseded while awaiting mic permission — the user already
        // clicked a different voice channel before this one finished
        // starting up. Stop this attempt's own stream immediately instead
        // of leaking an open microphone nothing will ever reference (the
        // newer join() already has, or is getting, its own).
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      localStreamRef.current = stream;
      watchSpeaking(user.id, stream);

      const { leave: leaveChannel, existingPeerIds } = await joinVoiceChannel(roomId, {
        onPresenceChange: (users) => {
          setParticipants(users);
          const currentIds = new Set(users.map((u) => u.user_id));
          knownPeerIdsRef.current.forEach((id) => {
            if (id !== user.id && !currentIds.has(id)) closePeer(id);
          });
          knownPeerIdsRef.current = currentIds;
        },
        onOffer: (payload) => void handleOffer(payload),
        onAnswer: (payload) => void handleAnswer(payload),
        onIceCandidate: (payload) => void handleIceCandidate(payload),
      });

      if (joinGenerationRef.current !== myGeneration) {
        // Superseded while awaiting the channel join — leave the room we
        // just joined and release this attempt's mic stream/analyser
        // instead of leaving a channel process (and an open microphone)
        // dangling that nothing in this hook's state points to anymore.
        leaveChannel();
        stream.getTracks().forEach((track) => track.stop());
        stopWatchingSpeaking(user.id);
        return;
      }

      leaveVoiceRef.current = leaveChannel;
      setActiveRoomId(roomId);

      // We're the newcomer: call everyone already in the room so each
      // pair negotiates exactly once (no simultaneous offer/offer glare).
      existingPeerIds
        .filter((peerId) => peerId !== user.id)
        .forEach((peerId) => void callPeer(peerId));
    } catch (err) {
      // Regardless of generation, this attempt's own resources are ours to
      // clean up — nothing else references them. Covers both a rejected
      // getUserMedia (stream stays null, both calls below are no-ops) and a
      // rejected joinVoiceChannel (stream is set and watchSpeaking already
      // started an AudioContext/rAF loop for it that would otherwise never
      // stop).
      stream?.getTracks().forEach((track) => track.stop());
      stopWatchingSpeaking(user.id);

      if (joinGenerationRef.current === myGeneration) {
        setError(err instanceof Error ? err.message : 'Mikrofona erişilemedi');
        localStreamRef.current = null;
      }
    }
  }

  return {
    activeRoomId,
    participants,
    speakingUserIds,
    remoteStreams,
    screenShares,
    isScreenSharing,
    isMuted,
    isDeafened,
    reconnectingPeerIds,
    error,
    join,
    leave,
    startScreenShare,
    stopScreenShare,
    toggleMute,
    toggleDeafen,
  };
}
