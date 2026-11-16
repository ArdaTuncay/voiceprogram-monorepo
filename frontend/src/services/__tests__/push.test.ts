import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  fetchPushConfig: vi.fn(),
  savePushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
}));

import { deletePushSubscription, fetchPushConfig, savePushSubscription } from '../api';
import {
  consumeOpenTarget,
  disablePush,
  enablePush,
  getPushState,
  parseOpenTarget,
  pushSupported,
} from '../push';

// The test VAPID public key from the backend's config/test.exs.
const PUBLIC_KEY =
  'BAd7h27EktTP7jXTGrAbcIDgacO50bdS909mv1w75dfs7oSYBmpWVaPFZAGy29Jzg0m-S1MLFjUX39WAT21xK00';

interface FakeBrowser {
  subscription: { endpoint: string; toJSON: () => object; unsubscribe: ReturnType<typeof vi.fn> } | null;
  subscribe: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
}

/** A browser with the Push API: a service worker registration whose
 * pushManager hands out `subscription`, and a Notification permission. */
function fakeBrowser(permission: NotificationPermission = 'default', existing = false): FakeBrowser {
  const made = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  const browser: FakeBrowser = {
    subscription: existing ? made : null,
    subscribe: vi.fn(async () => {
      browser.subscription = made;
      return made;
    }),
    requestPermission: vi.fn(async () => {
      if (permission === 'default') permission = 'granted';
      return permission;
    }),
  };
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => browser.subscription),
      subscribe: browser.subscribe,
    },
  };

  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal(
    'Notification',
    Object.assign(function Notification() {}, {
      get permission() {
        return permission;
      },
      requestPermission: browser.requestPermission,
    })
  );
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: vi.fn().mockResolvedValue(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
      ready: Promise.resolve(registration),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  return browser;
}

beforeEach(() => {
  vi.mocked(fetchPushConfig).mockResolvedValue({ data: { enabled: true, public_key: PUBLIC_KEY } });
  vi.mocked(savePushSubscription).mockResolvedValue({ data: undefined });
  vi.mocked(deletePushSubscription).mockResolvedValue({ data: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

describe('parseOpenTarget', () => {
  it('reads the targets the backend sends, and nothing else', () => {
    expect(parseOpenTarget('dm:room-1')).toEqual({ kind: 'dm', roomId: 'room-1' });
    expect(parseOpenTarget('channel:srv:chan')).toEqual({ kind: 'channel', serverId: 'srv', channelId: 'chan' });
    expect(parseOpenTarget('channel:srv')).toBeNull();
    expect(parseOpenTarget('javascript:alert(1)')).toBeNull();
    expect(parseOpenTarget(null)).toBeNull();
  });
});

describe('consumeOpenTarget', () => {
  it('takes ?open= from the address once and removes it', () => {
    window.history.replaceState(null, '', '/?open=dm%3Aroom-9&x=1');

    expect(consumeOpenTarget()).toEqual({ kind: 'dm', roomId: 'room-9' });
    expect(window.location.search).toBe('?x=1');
    expect(consumeOpenTarget()).toBeNull();
  });
});

describe('getPushState', () => {
  it('is unsupported without the Push API (e.g. an iPhone tab, the desktop app)', async () => {
    expect(pushSupported()).toBe(false);
    expect(await getPushState()).toBe('unsupported');
  });

  it('is unavailable when the server has no keys, on with a subscription, off without', async () => {
    fakeBrowser('granted', true);
    expect(await getPushState()).toBe('on');

    fakeBrowser('granted', false);
    expect(await getPushState()).toBe('off');

    fakeBrowser('denied', false);
    expect(await getPushState()).toBe('denied');

    vi.mocked(fetchPushConfig).mockResolvedValue({ data: { enabled: false, public_key: null } });
    expect(await getPushState()).toBe('unavailable');
  });
});

describe('enablePush / disablePush', () => {
  it('asks for permission, subscribes with the server key and saves the subscription', async () => {
    const browser = fakeBrowser();

    expect(await enablePush()).toBeNull();

    expect(browser.requestPermission).toHaveBeenCalled();
    const options = browser.subscribe.mock.calls[0][0];
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(options.applicationServerKey).toHaveLength(65);
    expect(options.applicationServerKey[0]).toBe(4);
    expect(savePushSubscription).toHaveBeenCalledWith({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p', auth: 'a' },
    });
  });

  it('stops when the user says no', async () => {
    const browser = fakeBrowser('denied');

    expect(await enablePush()).toMatch(/izni reddedildi/);
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(savePushSubscription).not.toHaveBeenCalled();
  });

  it('turning it off tells the server and unsubscribes the browser', async () => {
    const browser = fakeBrowser('granted', true);
    const subscription = browser.subscription!;

    await disablePush();

    expect(deletePushSubscription).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/abc');
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });
});
