import { useCallback, useRef, useState } from 'react';
import type { User, PresenceUser, VoiceSignalPayload } from '../types';
import {
  joinVoiceChannel,
  sendVoiceOffer,
  sendVoiceAnswer,
  sendIceCandidate,
  sendVoiceStatus,
} from '../services/socket';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

// Volume (0-255) above which a stream counts as "speaking", and how long
// the speaking indicator is held after the last loud sample (avoids flicker).
const SPEAKING_THRESHOLD = 12;
const SPEAKING_HOLD_MS = 300;

interface AnalyserHandle {
  ctx: AudioContext;
  raf: number;
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
  const [error, setError] = useState('');

  const leaveVoiceRef = useRef<(() => void) | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const analysersRef = useRef<Map<string, AnalyserHandle>>(new Map());
  const knownPeerIdsRef = useRef<Set<string>>(new Set());

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
    [stopWatchingSpeaking]
  );

  function createPeerConnection(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(ICE_SERVERS);

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
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        closePeer(peerId);
      }
    };

    peersRef.current.set(peerId, pc);
    return pc;
  }

  /** Reuses an existing connection to a peer if we have one (renegotiation), else creates one. */
  function getOrCreatePeerConnection(peerId: string): RTCPeerConnection {
    return peersRef.current.get(peerId) ?? createPeerConnection(peerId);
  }

  async function callPeer(peerId: string) {
    const pc = createPeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendVoiceOffer({ from: user.id, to: peerId, sdp: offer });
  }

  async function handleOffer(payload: VoiceSignalPayload) {
    if (payload.to !== user.id || !payload.sdp) return;
    // Reuse the existing connection when this is a renegotiation (e.g. a
    // peer just started or stopped screen sharing) rather than replacing it.
    const pc = getOrCreatePeerConnection(payload.from);
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    flushPendingCandidates(payload.from, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendVoiceAnswer({ from: user.id, to: payload.from, sdp: answer });
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
        Array.from(peersRef.current.entries()).map(async ([peerId, pc]) => {
          pc.addTrack(videoTrack, stream);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendVoiceOffer({ from: user.id, to: peerId, sdp: offer });
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
    leaveVoiceRef.current?.();
    leaveVoiceRef.current = null;

    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();

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
    setIsMuted(false);
    setIsDeafened(false);
  }, [stopWatchingSpeaking]);

  async function join(roomId: string) {
    leave();
    setError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

      leaveVoiceRef.current = leaveChannel;
      setActiveRoomId(roomId);

      // We're the newcomer: call everyone already in the room so each
      // pair negotiates exactly once (no simultaneous offer/offer glare).
      existingPeerIds
        .filter((peerId) => peerId !== user.id)
        .forEach((peerId) => void callPeer(peerId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mikrofona erişilemedi');
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
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
    error,
    join,
    leave,
    startScreenShare,
    stopScreenShare,
    toggleMute,
    toggleDeafen,
  };
}
