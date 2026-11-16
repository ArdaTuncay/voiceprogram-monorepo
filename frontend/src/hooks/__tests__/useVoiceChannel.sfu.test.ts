import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIceServersCacheForTests, useVoiceChannel } from '../useVoiceChannel';
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
      start: vi.fn(() => Promise.resolve()),
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
  resetIceServersCacheForTests();
  media = installWebrtcMocks();
  media.getUserMedia.mockResolvedValue(makeFakeStream());
  vi.stubGlobal('MediaStream', FakeMediaStream);
});

afterEach(() => {
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
});
