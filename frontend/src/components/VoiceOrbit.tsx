import { useMemo } from 'react';
import { MicOff, VolumeX, RefreshCw } from 'lucide-react';
import { circularLayout } from '../utils/circularLayout';
import './VoiceOrbit.css';

export interface OrbitParticipant {
  id: string;
  displayName: string;
  initials: string;
  avatarColor: string;
  isSpeaking: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isReconnecting: boolean;
  statusText: string;
}

interface Props {
  participants: OrbitParticipant[];
  /** Above this count the circle stops being legible (avatars would start
   * overlapping), so we fall back to the original stacked list instead.
   * Exposed as a prop so tests can exercise the boundary without needing
   * 9 fake participants; production always uses the default of 8. */
  maxOrbitSize?: number;
}

const ORBIT_RADIUS = 56;
const AVATAR_SIZE = 30;
const SPEAKING_SCALE = 1.2;
const ORBIT_CONTAINER_SIZE = ORBIT_RADIUS * 2 + AVATAR_SIZE * SPEAKING_SCALE;

function ParticipantAvatar({ p, size }: { p: OrbitParticipant; size: number }) {
  return (
    <div
      className={`voice-orbit-avatar${p.isSpeaking ? ' speaking' : ''}${p.isReconnecting ? ' reconnecting' : ''}`}
      style={{ width: size, height: size, background: p.avatarColor }}
      title={`${p.displayName} — ${p.statusText}`}
    >
      {p.initials}
      {p.isMuted && (
        <span className="voice-orbit-badge voice-orbit-badge-mute" title="Mikrofon Kapalı">
          <MicOff size={9} />
        </span>
      )}
      {p.isDeafened && (
        <span className="voice-orbit-badge voice-orbit-badge-deafen" title="Sağırlaştırıldı">
          <VolumeX size={9} />
        </span>
      )}
    </div>
  );
}

/** Renders a voice channel's participant list either as a circular "orbit"
 * (trigonometric layout, angle step 360/N, up to maxOrbitSize people) or —
 * once there are too many people for a circle to stay legible — the
 * original stacked list (kept verbatim as a fallback branch, not deleted).
 * A single participant (or zero) skips the circle math entirely, since a
 * circle of one point is meaningless.
 *
 * Orbit positions are recomputed only when the participant COUNT changes,
 * not on every render — geometry depends solely on how many slots exist,
 * not on who occupies them or their speaking/muted state. */
export default function VoiceOrbit({ participants, maxOrbitSize = 8 }: Props) {
  const n = participants.length;

  const positions = useMemo(() => {
    const center = ORBIT_CONTAINER_SIZE / 2;
    return circularLayout({ count: n, radius: ORBIT_RADIUS }).map(({ x, y }) => ({
      x: center + x,
      y: center + y,
    }));
  }, [n]);

  if (n <= 1) {
    return (
      <div className="voice-orbit-single">
        {participants.map((p) => (
          <ParticipantAvatar key={p.id} p={p} size={AVATAR_SIZE * (p.isSpeaking ? SPEAKING_SCALE : 1)} />
        ))}
      </div>
    );
  }

  if (n > maxOrbitSize) {
    return (
      <>
        {participants.map((p) => (
          <div key={p.id} className="voice-participant">
            <div
              className={`voice-participant-avatar${p.isSpeaking ? ' speaking' : ''}`}
              style={{ background: p.avatarColor }}
              title={p.displayName}
            >
              {p.initials}
            </div>
            <div className="voice-participant-info">
              <span className="voice-participant-name">
                {p.displayName}
                {p.isMuted && (
                  <span className="voice-status-icon mute-icon" title="Mikrofon Kapalı">
                    <MicOff size={10} />
                  </span>
                )}
                {p.isDeafened && (
                  <span className="voice-status-icon deafen-icon" title="Sağırlaştırıldı">
                    <VolumeX size={10} />
                  </span>
                )}
              </span>
              <span className={`voice-participant-status${p.isReconnecting ? ' reconnecting' : ''}`}>
                {p.isReconnecting && <RefreshCw size={10} />} {p.statusText}
              </span>
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="voice-orbit" style={{ width: ORBIT_CONTAINER_SIZE, height: ORBIT_CONTAINER_SIZE }}>
      {participants.map((p, i) => {
        const size = AVATAR_SIZE * (p.isSpeaking ? SPEAKING_SCALE : 1);
        const { x, y } = positions[i];
        return (
          <div key={p.id} className="voice-orbit-participant" style={{ left: x - size / 2, top: y - size / 2 }}>
            <ParticipantAvatar p={p} size={size} />
          </div>
        );
      })}
    </div>
  );
}
