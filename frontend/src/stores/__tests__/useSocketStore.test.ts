import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSocketSync } from '../useSocketStore';
import { useServerStore } from '../useServerStore';
import { useDMStore } from '../useDMStore';
import { useChatStore } from '../useChatStore';
import { useFriendStore } from '../useFriendStore';
import { useConnectionStore } from '../useConnectionStore';
import type { NewDmMessageNotification, NewMessageNotification, User } from '../../types';
import type { UserChannelCallbacks } from '../../services/socket';

vi.mock('../../services/socket', () => ({
  joinChatChannel: vi.fn().mockReturnValue(() => {}),
  joinDmChannel: vi.fn().mockReturnValue(() => {}),
  joinServerChannel: vi.fn().mockReturnValue(() => {}),
  joinUserChannel: vi.fn().mockReturnValue(() => {}),
}));

// Only needed for the "left the DM for a server" regression test below,
// which calls the real useServerStore.setActiveServerId action — that
// action fetches the new server's channels, so this has to resolve to
// something rather than hit a real network call. Partially mocked (real
// module otherwise) since useDMStore.handleNewDmMessage also reaches into
// this module (fetchDmRooms) for its own "unknown room" fallback.
vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    fetchServerChannels: vi.fn().mockResolvedValue({ data: [] }),
  };
});

import { joinUserChannel } from '../../services/socket';

const testUser: User = { id: 'me', username: 'ardatuncay', email: 'arda@example.com' };

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static instances: FakeNotification[] = [];
  title: string;
  options?: NotificationOptions;
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options;
    FakeNotification.instances.push(this);
  }
}

function baseMessage(overrides: Partial<NewMessageNotification> = {}): NewMessageNotification {
  return {
    id: 'msg-1',
    content: 'merhaba',
    file_url: null,
    file_type: null,
    user_id: 'other',
    username: 'other-user',
    inserted_at: new Date().toISOString(),
    is_edited: false,
    reactions: [],
    is_deleted: false,
    channel_id: 'chan-1',
    channel_name: 'genel',
    server_id: 'server-1',
    ...overrides,
  };
}

function baseDmMessage(overrides: Partial<NewDmMessageNotification> = {}): NewDmMessageNotification {
  return {
    id: 'dm-1',
    content: 'selam',
    file_url: null,
    file_type: null,
    user_id: 'other',
    username: 'other-user',
    inserted_at: new Date().toISOString(),
    is_edited: false,
    reactions: [],
    is_deleted: false,
    dm_room_id: 'room-1',
    ...overrides,
  };
}

/** Renders the hook and returns the callbacks object it passed to
 * joinUserChannel — the only way in, since onNewMessage/onNewDmMessage
 * aren't exported on their own (mirrors useVoiceChannel.test.ts's
 * mockJoinChannel helper). */
function captureUserChannelCallbacks(): UserChannelCallbacks {
  let captured!: UserChannelCallbacks;
  vi.mocked(joinUserChannel).mockImplementation((_userId, callbacks) => {
    captured = callbacks;
    return () => {};
  });
  renderHook(() => useSocketSync(testUser));
  return captured;
}

describe('useSocketSync — masaüstü bildirimleri', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      'zircle-notification-prefs',
      JSON.stringify({ enabled: true, sound: false, desktop: true, mentionsOnly: false })
    );
    useServerStore.getState().reset();
    useDMStore.getState().reset();
    useChatStore.getState().reset();
    useFriendStore.getState().reset();
    useConnectionStore.getState().reset();
    vi.clearAllMocks();
    FakeNotification.instances = [];
    FakeNotification.permission = 'granted';
    vi.stubGlobal('Notification', FakeNotification);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('new_message: notifies with tag=channel_id and renotify:true for a channel that is not active', () => {
    useServerStore.setState({ activeChannelId: 'some-other-channel' });
    const callbacks = captureUserChannelCallbacks();

    callbacks.onNewMessage(baseMessage());

    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].options).toMatchObject({
      tag: 'chan-1',
      renotify: true,
    });
  });

  it('new_message: does not notify for the currently active channel', () => {
    useServerStore.setState({ activeChannelId: 'chan-1' });
    const callbacks = captureUserChannelCallbacks();

    callbacks.onNewMessage(baseMessage({ channel_id: 'chan-1' }));

    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('new_dm_message: notifies with tag=dm_room_id and renotify:true for a room that is not active', () => {
    useDMStore.setState({ activeRoomId: 'some-other-room' });
    const callbacks = captureUserChannelCallbacks();

    callbacks.onNewDmMessage(baseDmMessage());

    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].options).toMatchObject({
      tag: 'room-1',
      renotify: true,
    });
  });

  it('new_dm_message: does not notify when the message is for the currently active DM room', () => {
    useDMStore.setState({ activeRoomId: 'room-1' });
    const callbacks = captureUserChannelCallbacks();

    callbacks.onNewDmMessage(baseDmMessage({ dm_room_id: 'room-1' }));

    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('new_dm_message: notifies for a DM the user has since left for a server — activeRoomId no longer stale', () => {
    // Regression test: activeRoomId used to never get cleared once a DM was
    // opened, so this exact scenario (open a DM, then leave it for a
    // server) kept suppressing that DM's notifications indefinitely. The
    // fix lives in useServerStore.setActiveServerId, which now clears
    // useDMStore's activeRoomId — this test goes through that real action
    // rather than useDMStore.setState, so it actually exercises the fix.
    useDMStore.getState().setActiveRoomId('room-1');
    useServerStore.getState().setActiveServerId('server-1');

    expect(useDMStore.getState().activeRoomId).toBeNull();

    const callbacks = captureUserChannelCallbacks();
    callbacks.onNewDmMessage(baseDmMessage({ dm_room_id: 'room-1' }));

    expect(FakeNotification.instances).toHaveLength(1);
  });
});
