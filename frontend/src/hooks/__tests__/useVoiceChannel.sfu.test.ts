import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SFU_DISCONNECT_GRACE_MS,
  SFU_RESTART_DELAYS_MS,
  resetIceServersCacheForTests,
  useVoiceChannel,
} from '../useVoiceChannel';
import type { PresenceUser, User } from '../../types';
import type { SfuCallbacks } from '../../services/sfu';
import type { VoiceChannelCallbacks } from '../../services/socket';
import {
  FakeMediaStream,
  FakeMediaStreamTrack,
  FakeRTCPeerConnection,
  installWebrtcMocks,
  makeFakeStream,
} from './webrtcTestUtils';

vi.mock('../../services/socket', () => ({
  joinVoiceChannel: vi.fn(),
  sendVoiceOffer: vi.fn(),
  sendVoiceAnswer: vi.fn(),
  sendIceCandidate: vi.fn(),
  sendVoiceStatus: vi.fn(),
  sendIceDiagnostics: vi.fn(),
  sendScreenShareStopped: vi.fn(),
  voiceRequest: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  fetchTurnCredentials: vi.fn(() => Promise.resolve({ data: { ice_servers: [] } })),
}));

/** Stands in for services/sfu.ts's SfuConnection (tested on its own). */
const sfu = vi.hoisted(() => ({
  /** While true, every new connection's start() fails (Cloudflare unreachable). */
  failStarts: false,
  instances: [] as {
    callbacks: SfuCallbacks;
    start: ReturnType<typeof vi.fn>;
    sync: ReturnType<typeof vi.fn>;
    publishScreen: ReturnType<typeof vi.fn>;
    unpublishScreen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock('../../services/sfu', () => ({
  SfuConnection: vi.fn(function (this: object, _signaling: unknown, _ice: unknown, callbacks: SfuCallbacks) {
    const instance = {
      callbacks,
      start: vi.fn(() => (sfu.failStarts ? Promise.reject(new Error('timeout')) : Promise.resolve())),
      sync: vi.fn(() => Promise.resolve()),
      publishScreen: vi.fn(() => Promise.resolve()),
      unpublishScreen: vi.fn(() => Promise.resolve()),
      close: vi.fn(),
    };
    sfu.instances.push(instance);
    Object.assign(this, instance);
  }),
}));

import { joinVoiceChannel, sendVoiceOffer } from '../../services/socket';

const me: User = { id: 'me', username: 'ard', email: 'a@example.com' };
const ayse: PresenceUser = { user_id: 'ayse', username: 'ayse', online_at: 1, sfu_tracks: ['audio'] };
const self: PresenceUser = { user_id: 'me', username: 'ard', online_at: 1, sfu_tracks: ['audio'] };

let media: ReturnType<typeof installWebrtcMocks>;

beforeEach(() => {
  sfu.instances.length = 0;
  sfu.failStarts = false;
  resetIceServersCacheForTests();
  media = installWebrtcMocks();
  media.getUserMedia.mockResolvedValue(makeFakeStream());
  vi.stubGlobal('MediaStream', FakeMediaStream);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function joinSfuRoom() {
  let callbacks!: VoiceChannelCallbacks;
  vi.mocked(joinVoiceChannel).mockImplementationOnce(async (_room, cb) => {
    callbacks = cb;
    // Presence can land before the join reply does.
    cb.onPresenceChange([self, ayse]);
    return { existingPeerIds: ['ayse'], sfu: true, leave: vi.fn() };
  });

  const hook = renderHook(() => useVoiceChannel(me));
  await act(async () => {
    await hook.result.current.join('room-1');
  });
  await waitFor(() => expect(sfu.instances).toHaveLength(1));
  return { hook, callbacks, connection: sfu.instances[0] };
}

describe('useVoiceChannel through the SFU', () => {
  it('publishes the mic to the SFU and pulls the others, without calling anyone peer to peer', async () => {
    const { hook, connection } = await joinSfuRoom();

    expect(connection.start).toHaveBeenCalledTimes(1);
    expect(connection.sync).toHaveBeenLastCalledWith([ayse]);
    expect(FakeRTCPeerConnection.instances).toHaveLength(0);
    expect(sendVoiceOffer).not.toHaveBeenCalled();

    act(() => hook.unmount());
  });

  it("puts pulled tracks where the UI reads them, and takes them away again", async () => {
    const { hook, connection } = await joinSfuRoom();
    const track = { kind: 'audio' } as MediaStreamTrack;

    act(() => connection.callbacks.onRemoteTrack('ayse', 'audio', track));
    expect(hook.result.current.remoteStreams.ayse).toBeDefined();

    act(() => connection.callbacks.onRemoteTrack('ayse', 'screen', { kind: 'video' } as MediaStreamTrack));
    expect(hook.result.current.screenShares.ayse).toBeDefined();

    act(() => connection.callbacks.onRemoteTrackRemoved('ayse', 'screen'));
    expect(hook.result.current.screenShares.ayse).toBeUndefined();

    act(() => connection.callbacks.onRemoteTrackRemoved('ayse', 'audio'));
    expect(hook.result.current.remoteStreams.ayse).toBeUndefined();

    act(() => hook.unmount());
  });

  it('follows presence changes, shows trouble on the one connection, and closes it on leave', async () => {
    const { hook, callbacks, connection } = await joinSfuRoom();

    act(() => callbacks.onPresenceChange([self]));
    expect(connection.sync).toHaveBeenLastCalledWith([]);

    act(() => callbacks.onPresenceChange([self, ayse]));
    act(() => connection.callbacks.onConnectionStateChange('disconnected'));
    expect(hook.result.current.reconnectingPeerIds.has('ayse')).toBe(true);
    act(() => connection.callbacks.onConnectionStateChange('connected'));
    expect(hook.result.current.reconnectingPeerIds.size).toBe(0);

    act(() => hook.result.current.leave());
    expect(connection.close).toHaveBeenCalled();
  });

  it('shares the screen through the SFU', async () => {
    const { hook, connection } = await joinSfuRoom();
    media.getDisplayMedia.mockResolvedValue(new FakeMediaStream([new FakeMediaStreamTrack('video')]));

    await act(async () => {
      await hook.result.current.startScreenShare();
    });
    expect(connection.publishScreen).toHaveBeenCalledTimes(1);

    await act(async () => {
      await hook.result.current.stopScreenShare();
    });
    expect(connection.unpublishScreen).toHaveBeenCalledTimes(1);

    act(() => hook.result.current.leave());
  });

  describe('when the connection drops for good', () => {
    /** Lets `ms` of fake time pass, with React's updates and the restart's
     * awaits flushed. */
    async function wait(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    it('starts over in a new session, sharing the screen again and pulling everyone', async () => {
      const { hook, connection } = await joinSfuRoom();
      media.getDisplayMedia.mockResolvedValue(new FakeMediaStream([new FakeMediaStreamTrack('video')]));
      await act(async () => {
        await hook.result.current.startScreenShare();
      });
      act(() => connection.callbacks.onRemoteTrack('ayse', 'audio', { kind: 'audio' } as MediaStreamTrack));
      vi.useFakeTimers();

      act(() => connection.callbacks.onConnectionStateChange('failed'));
      expect(hook.result.current.reconnectingPeerIds.has('ayse')).toBe(true);
      await wait(SFU_RESTART_DELAYS_MS[0]);

      expect(connection.close).toHaveBeenCalled();
      expect(sfu.instances).toHaveLength(2);
      const fresh = sfu.instances[1];
      expect(fresh.start).toHaveBeenCalledWith(expect.anything(), expect.anything(), { renew: true });
      expect(fresh.publishScreen).toHaveBeenCalledTimes(1);
      expect(fresh.sync).toHaveBeenLastCalledWith([ayse]);
      // The old connection's tracks are gone until the new one pulls them.
      expect(hook.result.current.remoteStreams.ayse).toBeUndefined();
      expect(hook.result.current.activeRoomId).toBe('room-1');

      act(() => fresh.callbacks.onConnectionStateChange('connected'));
      expect(hook.result.current.reconnectingPeerIds.size).toBe(0);

      // Late news from the closed connection changes nothing.
      act(() => connection.callbacks.onConnectionStateChange('failed'));
      await wait(SFU_RESTART_DELAYS_MS[0]);
      expect(sfu.instances).toHaveLength(2);

      act(() => hook.unmount());
    });

    it('waits out a short disconnect, and starts over after a long one', async () => {
      const { hook, connection } = await joinSfuRoom();
      vi.useFakeTimers();

      act(() => connection.callbacks.onConnectionStateChange('disconnected'));
      await wait(SFU_DISCONNECT_GRACE_MS - 100);
      act(() => connection.callbacks.onConnectionStateChange('connected'));
      await wait(SFU_DISCONNECT_GRACE_MS + SFU_RESTART_DELAYS_MS[0]);
      expect(sfu.instances).toHaveLength(1);

      act(() => connection.callbacks.onConnectionStateChange('disconnected'));
      await wait(SFU_DISCONNECT_GRACE_MS + SFU_RESTART_DELAYS_MS[0]);
      expect(sfu.instances).toHaveLength(2);

      act(() => hook.unmount());
    });

    it('starts over right away when the voice channel was joined again', async () => {
      const { hook, callbacks } = await joinSfuRoom();
      vi.useFakeTimers();

      act(() => callbacks.onRejoin?.());
      await wait(0);

      expect(sfu.instances).toHaveLength(2);
      expect(sfu.instances[1].start).toHaveBeenCalledWith(expect.anything(), expect.anything(), { renew: true });

      act(() => hook.unmount());
    });

    it('keeps trying with growing pauses, then gives up and leaves with an error', async () => {
      const { hook, connection } = await joinSfuRoom();
      vi.useFakeTimers();
      sfu.failStarts = true;

      act(() => connection.callbacks.onConnectionStateChange('failed'));
      for (const delay of SFU_RESTART_DELAYS_MS) await wait(delay);

      expect(sfu.instances).toHaveLength(1 + SFU_RESTART_DELAYS_MS.length);
      expect(hook.result.current.activeRoomId).toBeNull();
      expect(hook.result.current.error).not.toBe('');

      act(() => hook.unmount());
    });

    it('stops trying once the user leaves', async () => {
      const { hook, connection } = await joinSfuRoom();
      vi.useFakeTimers();

      act(() => connection.callbacks.onConnectionStateChange('failed'));
      act(() => hook.result.current.leave());
      await wait(SFU_RESTART_DELAYS_MS[0]);

      expect(sfu.instances).toHaveLength(1);
      act(() => hook.unmount());
    });
  });
});
