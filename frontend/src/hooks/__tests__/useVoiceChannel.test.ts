import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GLARE_RECOVERY_DELAY_MS, ICE_DISCONNECT_GRACE_MS, useVoiceChannel } from '../useVoiceChannel';
import type { User } from '../../types';
import type { VoiceChannelCallbacks, VoiceChannelHandle } from '../../services/socket';
import {
  deferred,
  FakeRTCPeerConnection,
  installWebrtcMocks,
  makeFakeStream,
  type FakeMediaStream,
} from './webrtcTestUtils';

vi.mock('../../services/socket', () => ({
  joinVoiceChannel: vi.fn(),
  sendVoiceOffer: vi.fn(),
  sendVoiceAnswer: vi.fn(),
  sendIceCandidate: vi.fn(),
  sendVoiceStatus: vi.fn(),
}));

import { joinVoiceChannel, sendVoiceAnswer, sendVoiceOffer } from '../../services/socket';

// Chosen so the lexicographic relationship to 'me' (this file's shared test
// user) is unambiguous at a glance, not incidental: 'aaa-peer' < 'me' <
// 'zzz-peer'. `handleOffer`'s glare tie-break is `user.id > payload.from`,
// so a peer id of 'aaa-peer' always makes *us* impolite, and 'zzz-peer'
// always makes us polite.
const testUser: User = { id: 'me', username: 'ardatuncay', email: 'a@example.com' };

function resolvedChannel(existingPeerIds: string[] = []): Promise<VoiceChannelHandle> {
  return Promise.resolve({ existingPeerIds, leave: vi.fn() });
}

/**
 * Mocks the next `joinVoiceChannel` call to resolve with `existingPeerIds`
 * and captures the callbacks object passed to it, so a test can invoke
 * `onOffer`/`onAnswer`/`onIceCandidate` directly afterwards — `handleOffer`
 * et al. aren't exported by the hook, this is the only way in.
 */
function mockJoinChannel(existingPeerIds: string[] = []): { callbacks: VoiceChannelCallbacks } {
  const captured = { callbacks: undefined as unknown as VoiceChannelCallbacks };
  vi.mocked(joinVoiceChannel).mockImplementationOnce((_roomId, callbacks) => {
    captured.callbacks = callbacks;
    return resolvedChannel(existingPeerIds);
  });
  return captured;
}

/**
 * Drains the microtask queue. `onOffer`/`onIceCandidate` are invoked
 * fire-and-forget from the hook (`onOffer: (payload) => void handleOffer(payload)`),
 * so there's no promise to await directly — a real macrotask tick
 * guarantees every already-scheduled microtask (however many `await`s deep)
 * has run, without needing to guess the exact chain length.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface ActiveHook {
  result: { current: ReturnType<typeof useVoiceChannel> };
  unmount: () => void;
}

let activeHooks: ActiveHook[] = [];

/**
 * `renderHook` wrapper that tracks every rendered instance so
 * `cleanupActiveHooks` (called from every `afterEach` below) can tear it
 * down. `useVoiceChannel` has no unmount-triggered cleanup of its own (no
 * `useEffect` return) — without this, a joined hook's `requestAnimationFrame`
 * loop (started by `watchSpeaking`) and mic stream would keep running past
 * the end of whichever test created it, leaking into the next one.
 */
function renderVoiceChannel(user: User): ActiveHook {
  const rendered = renderHook(() => useVoiceChannel(user));
  activeHooks.push(rendered);
  return rendered;
}

function cleanupActiveHooks(): void {
  activeHooks.forEach(({ result, unmount }) => {
    act(() => {
      result.current.leave();
    });
    unmount();
  });
  activeHooks = [];
}

// `.sequential` (not plain `describe`) is a deliberate, load-bearing choice,
// not decoration: `FakeRTCPeerConnection.instances` (see webrtcTestUtils.ts)
// is module-level mutable state reset in `beforeEach` and read via a
// positional index (`instances[0]`) from each test — safe only because
// tests here run one at a time. `.sequential` pins that even if a global
// vitest config ever defaults to concurrent, or a parent suite is marked
// `.concurrent`. It does NOT stop someone from explicitly writing
// `it.concurrent(...)` on one test in this file — that still wins locally.
// Don't add `.concurrent` anywhere in this file without redesigning
// `FakeRTCPeerConnection.instances` to not be shared, positional state.
describe.sequential('useVoiceChannel — joinGenerationRef race protection', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ getUserMedia } = installWebrtcMocks());
  });

  afterEach(() => {
    cleanupActiveHooks();
    vi.unstubAllGlobals();
  });

  it('a getUserMedia that resolves after a newer join() supersedes it: its stream is stopped and activeRoomId is untouched', async () => {
    const gumA = deferred<FakeMediaStream>();
    const streamB = makeFakeStream();

    getUserMedia
      .mockImplementationOnce(() => gumA.promise)
      .mockImplementationOnce(() => Promise.resolve(streamB));
    vi.mocked(joinVoiceChannel).mockReturnValue(resolvedChannel());

    const { result } = renderVoiceChannel(testUser);

    act(() => {
      void result.current.join('roomA');
    });

    act(() => {
      void result.current.join('roomB');
    });

    await waitFor(() => expect(result.current.activeRoomId).toBe('roomB'));

    const streamA = makeFakeStream();
    act(() => {
      gumA.resolve(streamA);
    });

    await waitFor(() => expect(streamA.getTracks()[0]?.stop).toHaveBeenCalled());
    expect(result.current.activeRoomId).toBe('roomB');
  });

  it('a joinVoiceChannel that resolves after a newer join() supersedes it: the channel is left immediately and its stream is stopped', async () => {
    const streamA = makeFakeStream();
    const streamB = makeFakeStream();
    getUserMedia
      .mockImplementationOnce(() => Promise.resolve(streamA))
      .mockImplementationOnce(() => Promise.resolve(streamB));

    const joinChannelA = deferred<VoiceChannelHandle>();
    const leaveChannelA = vi.fn();
    vi.mocked(joinVoiceChannel)
      .mockReturnValueOnce(joinChannelA.promise)
      .mockReturnValueOnce(resolvedChannel());

    const { result } = renderVoiceChannel(testUser);

    act(() => {
      void result.current.join('roomA');
    });

    // Wait for join('roomA') to reach (and suspend on) the joinVoiceChannel
    // await before starting the superseding join — otherwise room B's join()
    // could race ahead of room A's own synchronous prefix.
    await waitFor(() => expect(joinVoiceChannel).toHaveBeenCalledTimes(1));

    act(() => {
      void result.current.join('roomB');
    });

    await waitFor(() => expect(result.current.activeRoomId).toBe('roomB'));

    act(() => {
      joinChannelA.resolve({ existingPeerIds: [], leave: leaveChannelA });
    });

    await waitFor(() => expect(leaveChannelA).toHaveBeenCalled());
    expect(streamA.getTracks()[0]?.stop).toHaveBeenCalled();
    expect(result.current.activeRoomId).toBe('roomB');
  });

  it('a normal, non-superseded join sets activeRoomId and calls every existing peer', async () => {
    const stream = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    vi.mocked(joinVoiceChannel).mockReturnValue(resolvedChannel(['peer-1', 'peer-2']));

    const { result } = renderVoiceChannel(testUser);

    await act(async () => {
      await result.current.join('roomA');
    });

    expect(result.current.activeRoomId).toBe('roomA');

    // callPeer() is fire-and-forget from join()'s point of view, so its own
    // effects (createOffer -> setLocalDescription -> sendVoiceOffer) can
    // still be in flight once join()'s returned promise has resolved.
    await waitFor(() => {
      expect(sendVoiceOffer).toHaveBeenCalledWith(expect.objectContaining({ to: 'peer-1' }));
      expect(sendVoiceOffer).toHaveBeenCalledWith(expect.objectContaining({ to: 'peer-2' }));
    });
  });

  it('leave() bumps the join generation, invalidating any join() still in flight, and stops the mic stream', async () => {
    const joinedStream = makeFakeStream();
    getUserMedia.mockResolvedValueOnce(joinedStream);
    vi.mocked(joinVoiceChannel).mockReturnValueOnce(resolvedChannel());

    const { result } = renderVoiceChannel(testUser);

    await act(async () => {
      await result.current.join('roomA');
    });

    expect(result.current.activeRoomId).toBe('roomA');

    // Start a second join (e.g. the user re-clicks the same room) and hold
    // its getUserMedia open, so it's still in flight when leave() runs.
    const gumSecondAttempt = deferred<FakeMediaStream>();
    getUserMedia.mockImplementationOnce(() => gumSecondAttempt.promise);

    act(() => {
      void result.current.join('roomA');
    });

    act(() => {
      result.current.leave();
    });

    // leave() itself (not another join()) tore down the already-joined room ...
    expect(result.current.activeRoomId).toBeNull();
    expect(joinedStream.getTracks()[0]?.stop).toHaveBeenCalled();

    // ... and the in-flight second attempt's later getUserMedia resolution
    // is what proves leave() bumped joinGenerationRef: without that bump,
    // this would silently resurrect activeRoomId back to "roomA".
    const secondAttemptStream = makeFakeStream();
    act(() => {
      gumSecondAttempt.resolve(secondAttemptStream);
    });

    await waitFor(() =>
      expect(secondAttemptStream.getTracks()[0]?.stop).toHaveBeenCalled()
    );
    expect(result.current.activeRoomId).toBeNull();
  });
});

// NOTE on realism — `FakeRTCPeerConnection.signalingState` (webrtcTestUtils.ts)
// is a plain field no fake method ever mutates; every test below that needs
// a specific signaling state (e.g. `pc.signalingState = 'have-local-offer'`
// to construct a glare precondition) sets it BY HAND. That means these
// tests verify "given this signalingState, handleOffer takes the right
// branch" — they do NOT verify that a real RTCPeerConnection actually
// *reaches* that signalingState the way we assume (e.g. that
// `setLocalDescription(offer)` really does transition `stable` ->
// `have-local-offer`, or that a rollback really returns it to `stable`).
// That's a deliberate scope boundary, not an oversight: reimplementing the
// real spec's state machine in the fake would add real complexity for
// uncertain payoff (it's stable, well-specified browser behavior, not
// something this app's logic controls), and this file already has a
// `.sequential` requirement (see above) that a stateful fake would only
// tighten further. Verifying the actual browser transitions is scope for a
// separate real-browser integration/E2E test (e.g. Playwright), not this
// unit-level suite.
//
// See also the `.sequential` note above the previous `describe` block —
// the same `FakeRTCPeerConnection.instances` constraint applies here too.
describe.sequential('useVoiceChannel — handleOffer glare resolution, ICE queueing, connection-state recovery', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ getUserMedia } = installWebrtcMocks());
    getUserMedia.mockResolvedValue(makeFakeStream());
  });

  afterEach(() => {
    cleanupActiveHooks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('glare: the impolite side (larger id) drops the incoming offer and keeps its own', async () => {
    // We already have an outstanding offer to 'aaa-peer' (from callPeer, via
    // existingPeerIds below) by the time its own offer arrives — real glare
    // is two sides restarting ICE for the same connection at once.
    const channel = mockJoinChannel(['aaa-peer']);
    const { result } = renderVoiceChannel(testUser);

    await act(async () => {
      await result.current.join('roomA');
    });
    await waitFor(() =>
      expect(sendVoiceOffer).toHaveBeenCalledWith(expect.objectContaining({ to: 'aaa-peer' }))
    );

    const pc = FakeRTCPeerConnection.instances[0];
    expect(pc).toBeDefined();
    pc.signalingState = 'have-local-offer';
    const localDescriptionCallsBeforeGlare = pc.setLocalDescription.mock.calls.length;

    await act(async () => {
      channel.callbacks.onOffer({
        from: 'aaa-peer',
        to: testUser.id,
        sdp: { type: 'offer', sdp: 'incoming-glare-offer' },
      });
      await flushMicrotasks();
    });

    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
    // No further local description calls beyond the offer we'd already sent
    // — our own offer is left in place, not rolled back. (Not asserting
    // `pc.signalingState` here: the fake never mutates it — see the note
    // above this describe block — so checking it would only prove the fake
    // didn't touch a field none of its methods touch, not anything about
    // the hook.)
    expect(pc.setLocalDescription.mock.calls.length).toBe(localDescriptionCallsBeforeGlare);
  });

  it('glare: the polite side (smaller id) rolls its offer back and answers the incoming one', async () => {
    const channel = mockJoinChannel(['zzz-peer']);
    const { result } = renderVoiceChannel(testUser);

    await act(async () => {
      await result.current.join('roomA');
    });
    await waitFor(() =>
      expect(sendVoiceOffer).toHaveBeenCalledWith(expect.objectContaining({ to: 'zzz-peer' }))
    );

    const pc = FakeRTCPeerConnection.instances[0];
    pc.signalingState = 'have-local-offer';

    await act(async () => {
      channel.callbacks.onOffer({
        from: 'zzz-peer',
        to: testUser.id,
        sdp: { type: 'offer', sdp: 'incoming-glare-offer' },
      });
      await flushMicrotasks();
    });

    // Rollback happened before the incoming offer was applied ...
    const rollbackOrder = pc.setLocalDescription.mock.invocationCallOrder.find(
      (_, index) => pc.setLocalDescription.mock.calls[index]?.[0]?.type === 'rollback'
    );
    expect(rollbackOrder).toBeDefined();
    expect(pc.setRemoteDescription).toHaveBeenCalledTimes(1);
    expect(rollbackOrder).toBeLessThan(pc.setRemoteDescription.mock.invocationCallOrder[0]);

    // ... and then it answered the incoming offer.
    expect(pc.createAnswer).toHaveBeenCalledTimes(1);
    expect(pc.setLocalDescription).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'answer' })
    );
    expect(sendVoiceAnswer).toHaveBeenCalledWith(expect.objectContaining({ to: 'zzz-peer' }));
  });

  it('glare: a rollback that rejects retries with a delayed ICE restart instead of answering', async () => {
    vi.useFakeTimers();

    const channel = mockJoinChannel(['zzz-peer']);
    const { result } = renderVoiceChannel(testUser);

    await act(async () => {
      await result.current.join('roomA');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sendVoiceOffer).toHaveBeenCalledWith(expect.objectContaining({ to: 'zzz-peer' }));

    const pc = FakeRTCPeerConnection.instances[0];
    pc.signalingState = 'have-local-offer';
    pc.setLocalDescription.mockImplementationOnce(() => Promise.reject(new Error('rollback failed')));

    await act(async () => {
      channel.callbacks.onOffer({
        from: 'zzz-peer',
        to: testUser.id,
        sdp: { type: 'offer', sdp: 'incoming-glare-offer' },
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    // The incoming offer was never applied, and recovery hasn't fired yet —
    // it's scheduled GLARE_RECOVERY_DELAY_MS out.
    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
    expect(pc.restartIce).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GLARE_RECOVERY_DELAY_MS);
    });

    expect(pc.restartIce).toHaveBeenCalled();
    expect(pc.createOffer).toHaveBeenCalledWith({ iceRestart: true });
    expect(sendVoiceOffer).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'zzz-peer', sdp: expect.objectContaining({ type: 'offer' }) })
    );
  });

  it('non-glare: a normal incoming offer (stable signaling state) applies and answers directly, no rollback', async () => {
    const channel = mockJoinChannel([]);
    const { result } = renderVoiceChannel(testUser);

    await act(async () => {
      await result.current.join('roomA');
    });

    await act(async () => {
      channel.callbacks.onOffer({
        from: 'aaa-peer',
        to: testUser.id,
        sdp: { type: 'offer', sdp: 'incoming-offer' },
      });
      await flushMicrotasks();
    });

    const pc = FakeRTCPeerConnection.instances[0];
    expect(pc).toBeDefined();
    expect(pc.setLocalDescription).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rollback' })
    );
    expect(pc.setRemoteDescription).toHaveBeenCalledTimes(1);
    expect(pc.createAnswer).toHaveBeenCalledTimes(1);
    expect(sendVoiceAnswer).toHaveBeenCalledWith(expect.objectContaining({ to: 'aaa-peer' }));
  });

  it('an ICE candidate that arrives before the remote description is queued, then flushed once it is set', async () => {
    const channel = mockJoinChannel([]);
    const { result } = renderVoiceChannel(testUser);

    await act(async () => {
      await result.current.join('roomA');
    });

    // No connection exists yet for 'aaa-peer' at all — handleIceCandidate
    // must queue rather than apply.
    await act(async () => {
      channel.callbacks.onIceCandidate({
        from: 'aaa-peer',
        to: testUser.id,
        candidate: { candidate: 'fake-candidate-1' },
      });
      await flushMicrotasks();
    });

    expect(FakeRTCPeerConnection.instances).toHaveLength(0);

    // An offer from the same peer establishes the connection, sets the
    // remote description, and (per flushPendingCandidates) should apply the
    // queued candidate right after.
    await act(async () => {
      channel.callbacks.onOffer({
        from: 'aaa-peer',
        to: testUser.id,
        sdp: { type: 'offer', sdp: 'incoming-offer' },
      });
      await flushMicrotasks();
    });

    const pc = FakeRTCPeerConnection.instances[0];
    expect(pc.addIceCandidate).toHaveBeenCalledTimes(1);
    expect(pc.addIceCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ candidate: 'fake-candidate-1' })
    );
  });

  it('onconnectionstatechange: "disconnected" that recovers to "connected" within the grace period never restarts ICE', async () => {
    vi.useFakeTimers();

    mockJoinChannel(['aaa-peer']);
    const { result } = renderVoiceChannel(testUser);

    await act(async () => {
      await result.current.join('roomA');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const pc = FakeRTCPeerConnection.instances[0];

    act(() => {
      pc.connectionState = 'disconnected';
      pc.onconnectionstatechange?.();
    });
    act(() => {
      pc.connectionState = 'connected';
      pc.onconnectionstatechange?.();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ICE_DISCONNECT_GRACE_MS);
    });

    expect(pc.restartIce).not.toHaveBeenCalled();
  });

  it('onconnectionstatechange: "disconnected" that persists past the grace period restarts ICE', async () => {
    vi.useFakeTimers();

    mockJoinChannel(['aaa-peer']);
    const { result } = renderVoiceChannel(testUser);

    await act(async () => {
      await result.current.join('roomA');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const pc = FakeRTCPeerConnection.instances[0];

    act(() => {
      pc.connectionState = 'disconnected';
      pc.onconnectionstatechange?.();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ICE_DISCONNECT_GRACE_MS);
    });

    expect(pc.restartIce).toHaveBeenCalled();
  });

  it('onconnectionstatechange: "failed" restarts ICE immediately, without waiting out the grace period', async () => {
    vi.useFakeTimers();

    mockJoinChannel(['aaa-peer']);
    const { result } = renderVoiceChannel(testUser);

    await act(async () => {
      await result.current.join('roomA');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const pc = FakeRTCPeerConnection.instances[0];

    act(() => {
      pc.connectionState = 'failed';
      pc.onconnectionstatechange?.();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(pc.restartIce).toHaveBeenCalled();
  });
});
