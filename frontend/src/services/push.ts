import { deletePushSubscription, fetchPushConfig, savePushSubscription } from './api';
import { currentPushSubscription } from './pushSubscription';
import { t } from '../i18n';

/**
 * Notifications while Zircle is closed (Web Push — see the backend's
 * Backend.Push and public/sw.js). This browser is "on" when it holds a push
 * subscription; the server keeps a copy tied to the session that made it.
 */

export type PushState =
  /** No Push API here (Electron, an iPhone browser tab, an old browser). */
  | 'unsupported'
  /** The server has no VAPID keys configured. */
  | 'unavailable'
  /** The user blocked notifications for this site. */
  | 'denied'
  | 'on'
  | 'off';

/** Where a notification click should take the user. */
export type OpenTarget =
  | { kind: 'dm'; roomId: string }
  | { kind: 'channel'; serverId: string; channelId: string };

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    // Not the desktop app's app:// page: no service workers there.
    (window.location.protocol === 'https:' || window.location.protocol === 'http:') &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** An iPhone/iPad browser tab: push works there only once Zircle is added to
 * the home screen (and opened from it). */
export function needsHomeScreenInstall(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;
  return ios && !standalone;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

/** Registers public/sw.js once per page load; null where it can't be. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return Promise.resolve(null);
  registration ??= navigator.serviceWorker.register('/sw.js').catch(() => null);
  return registration;
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const { data } = await fetchPushConfig();
  if (!data?.enabled) return 'unavailable';
  if (Notification.permission === 'denied') return 'denied';
  return (await currentPushSubscription()) ? 'on' : 'off';
}

/** Asks for permission if needed, subscribes this browser and tells the
 * server. Resolves to an error message to show, or null on success. */
export async function enablePush(): Promise<string | null> {
  const { data: config } = await fetchPushConfig();
  if (!config?.enabled || !config.public_key) return t('Bildirim servisi şu an kullanılamıyor.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return t('Tarayıcı bildirim izni reddedildi — masaüstü bildirimleri gösterilemeyecek.');
  }

  try {
    const reg = await registerServiceWorker();
    if (!reg) return t('Bu tarayıcı uygulama kapalıyken bildirimi desteklemiyor.');
    await navigator.serviceWorker.ready;
    const subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(config.public_key),
      }));
    const { error } = await savePushSubscription(subscription.toJSON());
    return error ?? null;
  } catch {
    return t('Bildirim aboneliği oluşturulamadı.');
  }
}

/** Stops notifications for this browser, on the server and in the browser. */
export async function disablePush(): Promise<void> {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  await deletePushSubscription(subscription.endpoint);
  await subscription.unsubscribe().catch(() => false);
}

/** Re-sends an existing subscription after the app starts — the browser may
 * have rotated it, and it links it to the current session again. */
export async function syncPushSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  await registerServiceWorker();
  const subscription = await currentPushSubscription();
  if (subscription) await savePushSubscription(subscription.toJSON());
}

/** `"dm:<room>"` or `"channel:<server>:<channel>"` (see Backend.Push.payload/1). */
export function parseOpenTarget(value: string | null | undefined): OpenTarget | null {
  if (!value) return null;
  const [kind, a, b] = value.split(':');
  if (kind === 'dm' && a) return { kind: 'dm', roomId: a };
  if (kind === 'channel' && a && b) return { kind: 'channel', serverId: a, channelId: b };
  return null;
}

/** The target a notification click opened this page with (`?open=`), once —
 * the parameter is removed from the address bar. */
export function consumeOpenTarget(): OpenTarget | null {
  const url = new URL(window.location.href);
  const target = parseOpenTarget(url.searchParams.get('open'));
  if (url.searchParams.has('open')) {
    url.searchParams.delete('open');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
  return target;
}

/** Calls `onOpen` when a notification is clicked while Zircle is already
 * open (public/sw.js posts to the page). Returns the cleanup. */
export function listenForOpenTargets(onOpen: (target: OpenTarget) => void): () => void {
  if (!pushSupported()) return () => {};
  const handler = (event: MessageEvent) => {
    if (event.data?.type !== 'zircle:open') return;
    const target = parseOpenTarget(event.data.open);
    if (target) onOpen(target);
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
