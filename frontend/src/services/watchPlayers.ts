/**
 * The two players a watch party can drive (see components/WatchPartyPanel),
 * behind one interface: a YouTube embed and a plain <video> for direct links.
 *
 * YouTube is driven over the embed's postMessage protocol — the same
 * messages YouTube's own IFrame API script sends — instead of loading that
 * script: it would have to run inside our origin (next to the session
 * token) and be allowed by the CSP's script-src, while the iframe stays
 * isolated on youtube-nocookie.com and only needs frame-src.
 */

export interface PlayerEvents {
  onReady: () => void;
  /** The player started/paused/jumped — by the user or by us. */
  onPlay: (time: number) => void;
  onPause: (time: number) => void;
  onSeek: (time: number) => void;
}

export interface WatchPlayer {
  play(): void;
  pause(): void;
  seek(time: number): void;
  /** Ignored by players that can't do fine-grained rates. */
  setRate(rate: number): void;
  readonly canNudge: boolean;
  time(): number;
  playing(): boolean;
  buffering(): boolean;
  ended(): boolean;
  duration(): number | null;
  destroy(): void;
}

export const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com';

export function youtubeEmbedUrl(videoId: string, pageOrigin: string): string {
  const params = new URLSearchParams({
    enablejsapi: '1',
    origin: pageOrigin,
    playsinline: '1',
    rel: '0',
  });
  return `${YOUTUBE_ORIGIN}/embed/${encodeURIComponent(videoId)}?${params}`;
}

// YouTube player states (onStateChange / infoDelivery.playerState).
const YT_ENDED = 0;
const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_BUFFERING = 3;

/** A reported time this far from where it should have got to is a seek. */
const YT_SEEK_JUMP = 2;
/** After our own seekTo, the jump it causes isn't reported as a user seek. */
const YT_OWN_SEEK_GRACE_MS = 1500;

interface YouTubeMessage {
  event?: string;
  info?: unknown;
}

export function createYouTubePlayer(iframe: HTMLIFrameElement, events: PlayerEvents): WatchPlayer {
  let ready = false;
  let state = -1;
  let lastTime = 0;
  let lastTimeAt = performance.now();
  let duration: number | null = null;
  let ownSeekAt = -Infinity;
  let handshake = 0;

  const post = (message: Record<string, unknown>) => {
    iframe.contentWindow?.postMessage(JSON.stringify({ ...message, id: 1, channel: 'widget' }), YOUTUBE_ORIGIN);
  };
  const command = (func: string, args: unknown[] = []) => post({ event: 'command', func, args });

  const estimatedTime = () =>
    state === YT_PLAYING ? lastTime + (performance.now() - lastTimeAt) / 1000 : lastTime;

  const onTimeReport = (time: number) => {
    const predicted = estimatedTime();
    lastTime = time;
    lastTimeAt = performance.now();
    if (
      ready &&
      Math.abs(time - predicted) > YT_SEEK_JUMP &&
      performance.now() - ownSeekAt > YT_OWN_SEEK_GRACE_MS
    ) {
      events.onSeek(time);
    }
  };

  const onStateChange = (next: number) => {
    if (next === state) return;
    state = next;
    if (next === YT_PLAYING) events.onPlay(estimatedTime());
    else if (next === YT_PAUSED) events.onPause(estimatedTime());
  };

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== YOUTUBE_ORIGIN || event.source !== iframe.contentWindow) return;
    let data: YouTubeMessage;
    try {
      data = typeof event.data === 'string' ? (JSON.parse(event.data) as YouTubeMessage) : (event.data as YouTubeMessage);
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;

    // "alreadyInitialized": the embed answered an earlier listener already
    // (e.g. a player set up again on the same iframe) and won't repeat onReady.
    if ((data.event === 'onReady' || data.event === 'alreadyInitialized') && !ready) {
      ready = true;
      window.clearInterval(handshake);
      command('addEventListener', ['onStateChange']);
      events.onReady();
    } else if (data.event === 'onStateChange' && typeof data.info === 'number') {
      onStateChange(data.info);
    } else if ((data.event === 'infoDelivery' || data.event === 'initialDelivery') && data.info) {
      const info = data.info as { currentTime?: unknown; playerState?: unknown; duration?: unknown };
      if (typeof info.duration === 'number' && info.duration > 0) duration = info.duration;
      if (typeof info.currentTime === 'number') onTimeReport(info.currentTime);
      if (typeof info.playerState === 'number') onStateChange(info.playerState);
    }
  };

  window.addEventListener('message', onMessage);
  // The embed only starts talking once told someone is listening; keep
  // saying so until it answers (it may not have loaded yet).
  handshake = window.setInterval(() => post({ event: 'listening' }), 250);
  iframe.addEventListener('load', () => post({ event: 'listening' }));

  return {
    canNudge: false,
    play: () => command('playVideo'),
    pause: () => command('pauseVideo'),
    seek: (time) => {
      ownSeekAt = performance.now();
      lastTime = time;
      lastTimeAt = performance.now();
      command('seekTo', [time, true]);
    },
    setRate: () => {},
    time: estimatedTime,
    playing: () => state === YT_PLAYING,
    buffering: () => state === YT_BUFFERING,
    ended: () => state === YT_ENDED,
    duration: () => duration,
    destroy: () => {
      window.clearInterval(handshake);
      window.removeEventListener('message', onMessage);
    },
  };
}

export function createVideoElementPlayer(video: HTMLVideoElement, events: PlayerEvents): WatchPlayer {
  let waiting = false;

  const listeners: [string, () => void][] = [
    ['loadedmetadata', () => events.onReady()],
    ['play', () => events.onPlay(video.currentTime)],
    ['pause', () => events.onPause(video.currentTime)],
    ['seeked', () => events.onSeek(video.currentTime)],
    ['waiting', () => (waiting = true)],
    ['playing', () => (waiting = false)],
    ['canplay', () => (waiting = false)],
  ];
  for (const [name, fn] of listeners) video.addEventListener(name, fn);
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) queueMicrotask(events.onReady);

  return {
    canNudge: true,
    // Rejected when the browser blocks autoplay — the next correction
    // tries again, and the native controls are right there.
    play: () => void video.play().catch(() => {}),
    pause: () => video.pause(),
    seek: (time) => {
      video.currentTime = time;
    },
    setRate: (rate) => {
      if (video.playbackRate !== rate) video.playbackRate = rate;
    },
    time: () => video.currentTime,
    playing: () => !video.paused && !video.ended,
    buffering: () => waiting || video.seeking,
    ended: () => video.ended,
    duration: () => (Number.isFinite(video.duration) ? video.duration : null),
    destroy: () => {
      for (const [name, fn] of listeners) video.removeEventListener(name, fn);
    },
  };
}
