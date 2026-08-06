import { Hash, Headphones, Mic, MicOff, PhoneOff, VolumeX } from 'lucide-react';
import './VoiceStatusBar.css';

interface Props {
  /** Shown above the controls when provided. The persistent bottom-left bar
   * needs it (there's no channel-list row alongside it to label the
   * connection); the in-channel panel (under the active voice channel's own
   * row — see Chat.tsx's renderChannelRow) omits it, since that row already
   * shows the name right above. */
  roomName?: string | null;
  serverName?: string | null;
  /** 'fixed' pins this to the bottom-left of the whole layout (the always-
   * visible bar); 'inline' (default) embeds it wherever it's placed, no
   * positioning/background/border of its own — the in-channel panel's
   * existing container already provides that. */
  variant?: 'fixed' | 'inline';
  isMuted: boolean;
  isDeafened: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onLeave: () => void;
}

/** Mic/deafen/leave controls for the active voice room — shared by the
 * always-visible VoiceStatusBar (rendered once in Chat.tsx's main layout,
 * regardless of which server/DM/Arkadaşlar view is on screen) and the
 * in-channel panel under the active voice channel's own row in the channel
 * list. Screen sharing deliberately stays its own button outside this
 * component: it's only meaningful while actually looking at the channel
 * (the screen-share tiles/overlay only render there), unlike mute/deafen/
 * leave, which make sense from anywhere. */
export default function VoiceStatusBar({
  roomName,
  serverName,
  variant = 'inline',
  isMuted,
  isDeafened,
  onToggleMute,
  onToggleDeafen,
  onLeave,
}: Props) {
  return (
    <div className={`voice-status-bar voice-status-bar-${variant}`}>
      {roomName && (
        <div className="voice-status-bar-room">
          <Hash size={14} className="voice-status-bar-room-icon" />
          <div className="voice-status-bar-room-text">
            <span className="voice-status-bar-room-name">{roomName}</span>
            {serverName && <span className="voice-status-bar-server-name">{serverName}</span>}
          </div>
        </div>
      )}

      <div className="voice-status-bar-controls">
        <div className="voice-status-bar-col">
          <button
            className={`voice-control-btn${isMuted ? ' active' : ''}`}
            onClick={onToggleMute}
            title={isMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}
            aria-label={isMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}
          >
            {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <button
            className="voice-control-btn voice-leave-btn"
            onClick={onLeave}
            title="Kanaldan Ayrıl"
            aria-label="Kanaldan Ayrıl"
          >
            <PhoneOff size={16} />
          </button>
        </div>
        <button
          className={`voice-control-btn${isDeafened ? ' active' : ''}`}
          onClick={onToggleDeafen}
          title={isDeafened ? 'Sağırlaştırmayı Kaldır' : 'Sağırlaştır'}
          aria-label={isDeafened ? 'Sağırlaştırmayı Kaldır' : 'Sağırlaştır'}
        >
          {isDeafened ? <VolumeX size={16} /> : <Headphones size={16} />}
        </button>
      </div>
    </div>
  );
}
