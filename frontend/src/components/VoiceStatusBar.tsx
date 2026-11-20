import { Clapperboard, Headphones, Mic, MicOff, PhoneOff, ScreenShare, ScreenShareOff, VolumeX } from 'lucide-react';
import { useT } from '../i18n';
import './VoiceStatusBar.css';

interface Props {
  /** Shown above the controls when provided — the "Ses bağlı" card names the
   * room it's connected to, since it stays visible from every view. */
  roomName?: string | null;
  serverName?: string | null;
  /** 'fixed' is the always-visible "Ses bağlı" card (Chat.tsx places it at
   * the bottom of the channel column, or across the bottom on phones);
   * 'inline' (default) is the bare button row, no card of its own. */
  variant?: 'fixed' | 'inline';
  isMuted: boolean;
  isDeafened: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onLeave: () => void;
  /** Screen sharing and "Birlikte İzle" — optional, so the card only shows
   * them where they're wired up. */
  isScreenSharing?: boolean;
  onToggleScreenShare?: () => void;
  isWatchPartyOpen?: boolean;
  onToggleWatchParty?: () => void;
}

/** Mic/deafen/leave controls for the active voice room, plus screen sharing
 * and Birlikte İzle when given — one row of round buttons. The mic button is
 * filled with the accent while it's live, so "they can hear me" is obvious
 * at a glance; muted, deafened and leave use red. */
export default function VoiceStatusBar({
  roomName,
  serverName,
  variant = 'inline',
  isMuted,
  isDeafened,
  onToggleMute,
  onToggleDeafen,
  onLeave,
  isScreenSharing = false,
  onToggleScreenShare,
  isWatchPartyOpen = false,
  onToggleWatchParty,
}: Props) {
  const t = useT();
  return (
    <section
      className={`voice-status-bar voice-status-bar-${variant}`}
      aria-label={t('Ses bağlantısı')}
    >
      {roomName && (
        <div className="voice-status-bar-room">
          <span className="voice-status-bar-state">{t('Ses bağlı')}</span>
          <span className="voice-status-bar-room-text">
            <span className="voice-status-bar-room-name">{roomName}</span>
            {serverName && (
              <>
                <span className="voice-status-bar-separator" aria-hidden="true"> / </span>
                <span className="voice-status-bar-server-name">{serverName}</span>
              </>
            )}
          </span>
        </div>
      )}

      <div className="voice-status-bar-controls">
        <button
          type="button"
          className={`voice-control-btn${isMuted ? ' active' : ' on'}`}
          onClick={onToggleMute}
          title={isMuted ? t('Mikrofonu Aç') : t('Mikrofonu Kapat')}
          aria-label={isMuted ? t('Mikrofonu Aç') : t('Mikrofonu Kapat')}
        >
          {isMuted ? <MicOff size={18} strokeWidth={1.75} /> : <Mic size={18} strokeWidth={1.75} />}
        </button>
        <button
          type="button"
          className={`voice-control-btn${isDeafened ? ' active' : ''}`}
          onClick={onToggleDeafen}
          title={isDeafened ? t('Sağırlaştırmayı Kaldır') : t('Sağırlaştır')}
          aria-label={isDeafened ? t('Sağırlaştırmayı Kaldır') : t('Sağırlaştır')}
        >
          {isDeafened ? <VolumeX size={18} strokeWidth={1.75} /> : <Headphones size={18} strokeWidth={1.75} />}
        </button>
        {onToggleScreenShare && (
          <button
            type="button"
            className={`voice-control-btn${isScreenSharing ? ' on' : ''}`}
            onClick={onToggleScreenShare}
            title={isScreenSharing ? t('Ekranı Durdur') : t('Ekranı Paylaş')}
            aria-label={isScreenSharing ? t('Ekranı Durdur') : t('Ekranı Paylaş')}
          >
            {isScreenSharing ? (
              <ScreenShareOff size={18} strokeWidth={1.75} />
            ) : (
              <ScreenShare size={18} strokeWidth={1.75} />
            )}
          </button>
        )}
        {onToggleWatchParty && (
          <button
            type="button"
            className={`voice-control-btn${isWatchPartyOpen ? ' on' : ''}`}
            onClick={onToggleWatchParty}
            title={t('Birlikte İzle')}
            aria-label={t('Birlikte İzle')}
            aria-pressed={isWatchPartyOpen}
          >
            <Clapperboard size={18} strokeWidth={1.75} />
          </button>
        )}
        <button
          type="button"
          className="voice-control-btn voice-leave-btn"
          onClick={onLeave}
          title={t('Kanaldan Ayrıl')}
          aria-label={t('Kanaldan Ayrıl')}
        >
          <PhoneOff size={18} strokeWidth={1.75} />
        </button>
      </div>
    </section>
  );
}
