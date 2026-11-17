import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Clapperboard, Play, X } from 'lucide-react';
import type { WatchSource } from '../types';
import type { WatchParty } from '../hooks/useWatchParty';
import { useT } from '../i18n';
import {
  createVideoElementPlayer,
  createYouTubePlayer,
  youtubeEmbedUrl,
  type PlayerEvents,
  type WatchPlayer,
} from '../services/watchPlayers';
import {
  decideCorrection,
  localActionToSend,
  sourceHost,
  sourceKey,
  type LocalAction,
} from '../utils/watchSync';
import './WatchPartyPanel.css';

/** How often the player is checked against the shared state. */
const SYNC_INTERVAL_MS = 1000;

interface WatchPartyPanelProps {
  party: WatchParty;
  /** Display name for a user id in the voice room. */
  nameOf: (userId: string) => string;
  /** Hide the panel (only offered while nothing is playing). */
  onClose: () => void;
}

/**
 * "Birlikte izle": the shared video of the voice room (see useWatchParty).
 * Each viewer first agrees to load it — the video comes straight from
 * YouTube or the linked site, which sees their IP address, and the click is
 * also what lets the browser start it with sound.
 */
export default function WatchPartyPanel({ party, nameOf, onClose }: WatchPartyPanelProps) {
  const t = useT();
  const [joinedHosts, setJoinedHosts] = useState<ReadonlySet<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const { video } = party;

  if (!video) {
    return (
      <section className="watch-panel" aria-label={t('Birlikte izle')}>
        <header className="watch-panel-header">
          <Clapperboard size={16} />
          <span className="watch-panel-title">{t('Birlikte izle')}</span>
          <button type="button" className="watch-panel-icon-btn" onClick={onClose} aria-label={t('Kapat')} title={t('Kapat')}>
            <X size={16} />
          </button>
        </header>
        <p className="watch-panel-hint">
          {t('Bir YouTube bağlantısı ya da bir video adresi yapıştır; odadaki herkes aynı anda izler.')}
        </p>
        <LoadForm party={party} />
      </section>
    );
  }

  const host = sourceHost(video.source);
  const joined = joinedHosts.has(host);

  return (
    <section className="watch-panel" aria-label={t('Birlikte izle')}>
      <header className="watch-panel-header">
        <Clapperboard size={16} />
        <span className="watch-panel-title">{t('Birlikte izle')}</span>
        <span className="watch-panel-meta">
          {t('{name} açtı · {host}', { name: nameOf(video.updated_by), host })}
        </span>
        <button type="button" className="watch-panel-text-btn" onClick={() => setShowForm((v) => !v)}>
          {t('Değiştir')}
        </button>
        <button
          type="button"
          className="watch-panel-text-btn danger"
          onClick={party.clear}
          title={t('Videoyu herkes için kapat')}
        >
          {t('Videoyu kapat')}
        </button>
      </header>

      {showForm && <LoadForm party={party} onLoaded={() => setShowForm(false)} />}

      {joined ? (
        <SyncedPlayer key={sourceKey(video.source)} source={video.source} party={party} />
      ) : (
        <div className="watch-panel-consent">
          <p>
            {t('Video {host} üzerinden yüklenecek; bu site IP adresini görebilir.', { host })}
          </p>
          <button
            type="button"
            className="watch-panel-join-btn"
            onClick={() => setJoinedHosts((prev) => new Set(prev).add(host))}
          >
            <Play size={14} /> {t('İzlemeye katıl')}
          </button>
        </div>
      )}
    </section>
  );
}

function LoadForm({ party, onLoaded }: { party: WatchParty; onLoaded?: () => void }) {
  const t = useT();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await party.load(url.trim());
      setUrl('');
      onLoaded?.();
    } catch (err) {
      const reason = err instanceof Error ? err.message : '';
      setError(
        reason === 'invalid_url'
          ? t('Bu bağlantı açılamadı. Bir YouTube bağlantısı ya da https:// ile başlayan bir video adresi gir.')
          : reason === 'rate_limited'
            ? t('Çok sık video değiştirildi. Biraz bekleyip tekrar dene.')
            : t('Video açılamadı. Tekrar dene.')
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="watch-panel-form" onSubmit={(e) => void handleSubmit(e)}>
      <input
        type="url"
        className="watch-panel-input"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=…"
        aria-label={t('Video bağlantısı')}
        autoFocus
      />
      <button type="submit" className="watch-panel-join-btn" disabled={busy || !url.trim()}>
        {t('Aç')}
      </button>
      {error && (
        <p className="watch-panel-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Plays `source` and keeps it on the shared state: every
 * SYNC_INTERVAL_MS (and whenever the state changes) it corrects the
 * player, and it sends what the user does in the player to everyone.
 */
function SyncedPlayer({ source, party }: { source: WatchSource; party: WatchParty }) {
  const t = useT();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<WatchPlayer | null>(null);
  const readyRef = useRef(false);
  const [failed, setFailed] = useState(false);
  // The player is set up once per source: the parent keys this component by
  // sourceKey(), while `source` itself is a new object on every broadcast.
  const kind = source.kind;

  // Read from the player's event handlers, which are set up once.
  const latest = useRef({ video: party.video, serverNow: party.serverNow, send: party.send });
  latest.current = { video: party.video, serverNow: party.serverNow, send: party.send };

  const sync = () => {
    const player = playerRef.current;
    const video = latest.current.video;
    if (!player || !readyRef.current || !video) return;
    const correction = decideCorrection(
      {
        time: player.time(),
        playing: player.playing(),
        buffering: player.buffering(),
        ended: player.ended(),
        duration: player.duration(),
      },
      video,
      latest.current.serverNow(),
      player.canNudge
    );
    switch (correction.kind) {
      case 'none':
        player.setRate(correction.rate);
        break;
      case 'seek':
        player.setRate(correction.rate);
        player.seek(correction.to);
        break;
      case 'play':
        if (correction.to !== null) player.seek(correction.to);
        player.play();
        break;
      case 'pause':
        player.pause();
        if (correction.to !== null) player.seek(correction.to);
        break;
    }
  };
  const syncRef = useRef(sync);
  syncRef.current = sync;

  useEffect(() => {
    const local = (action: LocalAction) => (time: number) => {
      const player = playerRef.current;
      const video = latest.current.video;
      if (!player || !readyRef.current || !video) return;
      const toSend = localActionToSend(action, time, video, latest.current.serverNow(), player.ended());
      if (toSend) latest.current.send(toSend.event, toSend.position);
    };
    const events: PlayerEvents = {
      onReady: () => {
        readyRef.current = true;
        syncRef.current();
      },
      onPlay: local('play'),
      onPause: local('pause'),
      onSeek: local('seek'),
    };

    const player =
      kind === 'youtube'
        ? iframeRef.current && createYouTubePlayer(iframeRef.current, events)
        : videoElRef.current && createVideoElementPlayer(videoElRef.current, events);
    playerRef.current = player;
    const interval = window.setInterval(() => syncRef.current(), SYNC_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      player?.destroy();
      playerRef.current = null;
      readyRef.current = false;
    };
  }, [kind]);

  // Follow a change from someone else right away, not on the next tick.
  useEffect(() => {
    syncRef.current();
  }, [party.video]);

  return (
    <div className="watch-panel-player">
      {source.kind === 'youtube' ? (
        <iframe
          ref={iframeRef}
          src={youtubeEmbedUrl(source.id, window.location.origin)}
          title={t('YouTube videosu')}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : failed ? (
        <p className="watch-panel-error">{t('Bu video oynatılamadı. Bağlantı doğrudan bir video dosyasına gitmiyor olabilir.')}</p>
      ) : (
        <video ref={videoElRef} src={source.url} controls playsInline preload="auto" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

