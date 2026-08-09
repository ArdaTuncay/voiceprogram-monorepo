import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
  /** This peer's current playback volume (0-1) — only read when
   * `onVolumeChange` is passed to `VoiceOrbit` (see below); defaults to 1
   * (full volume) when omitted, so callers that don't use the volume
   * popover feature can leave this out entirely. */
  volume?: number;
}

interface Props {
  participants: OrbitParticipant[];
  /** Above this count the circle stops being legible (avatars would start
   * overlapping), so we fall back to the original stacked list instead.
   * Exposed as a prop so tests can exercise the boundary without needing
   * 9 fake participants; production always uses the default of 8. */
  maxOrbitSize?: number;
  /** The viewer's own id — clicking your own avatar never opens the volume
   * popover (turning down your own playback makes no sense). Required
   * alongside `onVolumeChange` to enable the popover at all; omit both to
   * render plain, non-interactive avatars. */
  currentUserId?: string;
  /** Called with (peerId, volume 0-1) as the popover's slider moves.
   * Omitting this (along with `currentUserId`) disables the click-to-open
   * volume popover entirely — avatars render exactly as before. */
  onVolumeChange?: (peerId: string, volume: number) => void;
}

const ORBIT_RADIUS = 56;
const AVATAR_SIZE = 30;
const SPEAKING_SCALE = 1.2;
const ORBIT_CONTAINER_SIZE = ORBIT_RADIUS * 2 + AVATAR_SIZE * SPEAKING_SCALE;

// Only used to clamp the popover so it can't open close enough to the
// viewport edge to run off-screen — same "safe upper-bound estimate, not
// the real rendered size" reasoning as ServerAddMenu's own
// MENU_ESTIMATED_WIDTH.
const VOLUME_POPOVER_ESTIMATED_WIDTH = 160;
const VOLUME_POPOVER_MARGIN = 8;

/**
 * Wraps a single avatar with a click-to-open volume popover — a small
 * `<input type="range">` that calls `onVolumeChange` live as it moves.
 * Positioned with `position: fixed` and a JS-computed anchor (same pattern,
 * for the same reason, as ServerAddMenu's own `openMenu`), closing on
 * click-outside or ESC (same pattern as ServerAddMenu/MessageContextMenu).
 */
function AvatarWithVolumePopover({
  peerId,
  volume,
  onVolumeChange,
  children,
}: {
  peerId: string;
  volume: number;
  onVolumeChange: (peerId: string, volume: number) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);

  const openPopover = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const maxLeft = window.innerWidth - VOLUME_POPOVER_ESTIMATED_WIDTH - VOLUME_POPOVER_MARGIN;
      setAnchor({
        left: Math.max(VOLUME_POPOVER_MARGIN, Math.min(rect.left, maxLeft)),
        top: rect.bottom + VOLUME_POPOVER_MARGIN,
      });
    }
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const percent = Math.round(volume * 100);

  return (
    <div className="voice-orbit-volume-anchor" ref={rootRef}>
      <button
        type="button"
        className="voice-orbit-volume-trigger"
        onClick={() => (open ? setOpen(false) : openPopover())}
        aria-haspopup="true"
        aria-expanded={open}
        title="Ses seviyesini ayarla"
      >
        {children}
      </button>
      {open && (
        <div
          className="voice-orbit-volume-popover"
          style={{ left: anchor.left, top: anchor.top }}
          role="menu"
        >
          <input
            type="range"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => onVolumeChange(peerId, Number(e.target.value) / 100)}
            className="voice-orbit-volume-slider"
            aria-label="Ses seviyesi"
          />
          <span className="voice-orbit-volume-value">{percent}%</span>
        </div>
      )}
    </div>
  );
}

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
export default function VoiceOrbit({ participants, maxOrbitSize = 8, currentUserId, onVolumeChange }: Props) {
  const n = participants.length;

  const positions = useMemo(() => {
    const center = ORBIT_CONTAINER_SIZE / 2;
    return circularLayout({ count: n, radius: ORBIT_RADIUS }).map(({ x, y }) => ({
      x: center + x,
      y: center + y,
    }));
  }, [n]);

  // Whether a given peer's avatar should open the volume popover on click —
  // both the feature toggle (onVolumeChange passed at all) and the "not
  // your own avatar" rule live here so all three render branches below stay
  // in sync.
  function hasVolumePopover(peerId: string): boolean {
    return !!onVolumeChange && peerId !== currentUserId;
  }

  if (n <= 1) {
    return (
      <div className="voice-orbit-single">
        {participants.map((p) => {
          const size = AVATAR_SIZE * (p.isSpeaking ? SPEAKING_SCALE : 1);
          if (hasVolumePopover(p.id)) {
            return (
              <AvatarWithVolumePopover key={p.id} peerId={p.id} volume={p.volume ?? 1} onVolumeChange={onVolumeChange!}>
                <ParticipantAvatar p={p} size={size} />
              </AvatarWithVolumePopover>
            );
          }
          return <ParticipantAvatar key={p.id} p={p} size={size} />;
        })}
      </div>
    );
  }

  if (n > maxOrbitSize) {
    return (
      <>
        {participants.map((p) => {
          const avatar = (
            <div
              className={`voice-participant-avatar${p.isSpeaking ? ' speaking' : ''}`}
              style={{ background: p.avatarColor }}
              title={p.displayName}
            >
              {p.initials}
            </div>
          );
          return (
            <div key={p.id} className="voice-participant">
              {hasVolumePopover(p.id) ? (
                <AvatarWithVolumePopover peerId={p.id} volume={p.volume ?? 1} onVolumeChange={onVolumeChange!}>
                  {avatar}
                </AvatarWithVolumePopover>
              ) : (
                avatar
              )}
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
          );
        })}
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
            {hasVolumePopover(p.id) ? (
              <AvatarWithVolumePopover peerId={p.id} volume={p.volume ?? 1} onVolumeChange={onVolumeChange!}>
                <ParticipantAvatar p={p} size={size} />
              </AvatarWithVolumePopover>
            ) : (
              <ParticipantAvatar p={p} size={size} />
            )}
          </div>
        );
      })}
    </div>
  );
}
