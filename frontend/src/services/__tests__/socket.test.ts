import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from './phoenixTestTransport';
import {
  deleteDmMessage,
  deleteMessage,
  disconnectSocket,
  editDmMessage,
  editMessage,
  joinChatChannel,
  joinDmChannel,
  joinVoiceChannel,
  sendDmMessage,
  shout,
  toggleDmReaction,
  toggleReaction,
} from '../socket';
import type { ChannelCallbacks, VoiceChannelCallbacks } from '../socket';
import { VOICE_JOIN_TIMEOUT_REASON } from '../../utils/errorMessages';

// Phoenix's default push timeout (DEFAULT_TIMEOUT in phoenix's constants.js).
const PUSH_TIMEOUT_MS = 10_000;

function channelCallbacks(): ChannelCallbacks {
  return {
    onShout: vi.fn(),
    onJoined: vi.fn(),
    onError: vi.fn(),
    onPresenceChange: vi.fn(),
    onTyping: vi.fn(),
    onReactionToggled: vi.fn(),
    onMessageUpdated: vi.fn(),
    onMessageDeleted: vi.fn(),
  };
}

/** Joins a text channel through the real Phoenix client, with the fake
 * server accepting the connection and the join. */
function joinChat(channelId = 'c1'): FakeWebSocket {
  joinChatChannel(channelId, channelCallbacks());
  const ws = FakeWebSocket.latest();
  ws.open();
  ws.reply(ws.lastFrame(`chat:${channelId}`, 'phx_join'), 'ok', { messages: [] });
  return ws;
}

function joinDm(roomId = 'r1'): FakeWebSocket {
  joinDmChannel(roomId, channelCallbacks());
  const ws = FakeWebSocket.latest();
  ws.open();
  ws.reply(ws.lastFrame(`dm:${roomId}`, 'phx_join'), 'ok', { messages: [] });
  return ws;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  disconnectSocket();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// PROJECT_ARCHITECTURE.md §7 #11 — the pushes ChatChannel/DmChannel reply to.
describe('chat pushes — failure feedback', () => {
  it('shout hands a rejection\'s reason to onFailure', () => {
    const ws = joinChat();
    const onFailure = vi.fn();

    shout('hello', undefined, undefined, onFailure);
    ws.reply(ws.lastFrame('chat:c1', 'shout'), 'error', { reason: 'rate_limited' });

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith({ kind: 'error', reason: 'rate_limited' });
  });

  it('shout reports a changeset rejection (no reason) as an error without one', () => {
    const ws = joinChat();
    const onFailure = vi.fn();

    shout('hello', undefined, undefined, onFailure);
    ws.reply(ws.lastFrame('chat:c1', 'shout'), 'error', { errors: { content: ['is too long'] } });

    expect(onFailure).toHaveBeenCalledWith({ kind: 'error', reason: undefined });
  });

  it('shout reports a push that never got a reply as a timeout', async () => {
    joinChat();
    const onFailure = vi.fn();

    shout('hello', undefined, undefined, onFailure);
    await vi.advanceTimersByTimeAsync(PUSH_TIMEOUT_MS - 1);
    expect(onFailure).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onFailure).toHaveBeenCalledWith({ kind: 'timeout' });
  });

  it('shout never calls onFailure once the server accepted it', async () => {
    const ws = joinChat();
    const onFailure = vi.fn();

    shout('hello', undefined, undefined, onFailure);
    ws.reply(ws.lastFrame('chat:c1', 'shout'), 'ok');
    await vi.advanceTimersByTimeAsync(PUSH_TIMEOUT_MS * 2);

    expect(onFailure).not.toHaveBeenCalled();
  });

  it.each([
    ['toggle_reaction', (f: () => void) => toggleReaction('m1', '👍', f), 'message_not_found'],
    ['update_message', (f: () => void) => editMessage('m1', 'edited', f), 'not authorized'],
    ['delete_message', (f: () => void) => deleteMessage('m1', f), 'message not found'],
  ])('%s hands a rejection\'s reason to onFailure', (event, push, reason) => {
    const ws = joinChat();
    const onFailure = vi.fn();

    push(onFailure);
    ws.reply(ws.lastFrame('chat:c1', event), 'error', { reason });

    expect(onFailure).toHaveBeenCalledWith({ kind: 'error', reason });
  });

  it('only shout reports timeouts — edit/delete/reaction stay silent without a reply', async () => {
    joinChat();
    const onFailure = vi.fn();

    toggleReaction('m1', '👍', onFailure);
    editMessage('m1', 'edited', onFailure);
    deleteMessage('m1', onFailure);
    await vi.advanceTimersByTimeAsync(PUSH_TIMEOUT_MS * 2);

    expect(onFailure).not.toHaveBeenCalled();
  });
});

describe('DM pushes — failure feedback', () => {
  it('sendDmMessage hands a "blocked" rejection to onFailure', () => {
    const ws = joinDm();
    const onFailure = vi.fn();

    sendDmMessage('hello', undefined, undefined, onFailure);
    ws.reply(ws.lastFrame('dm:r1', 'shout'), 'error', { reason: 'blocked' });

    expect(onFailure).toHaveBeenCalledWith({ kind: 'error', reason: 'blocked' });
  });

  it('sendDmMessage reports a push that never got a reply as a timeout', async () => {
    joinDm();
    const onFailure = vi.fn();

    sendDmMessage('hello', undefined, undefined, onFailure);
    await vi.advanceTimersByTimeAsync(PUSH_TIMEOUT_MS);

    expect(onFailure).toHaveBeenCalledWith({ kind: 'timeout' });
  });

  it.each([
    ['toggle_reaction', (f: () => void) => toggleDmReaction('m1', '👍', f), 'rate_limited'],
    ['update_message', (f: () => void) => editDmMessage('m1', 'edited', f), 'rate_limited'],
    ['delete_message', (f: () => void) => deleteDmMessage('m1', f), 'rate_limited'],
  ])('%s hands a rejection\'s reason to onFailure', (event, push, reason) => {
    const ws = joinDm();
    const onFailure = vi.fn();

    push(onFailure);
    ws.reply(ws.lastFrame('dm:r1', event), 'error', { reason });

    expect(onFailure).toHaveBeenCalledWith({ kind: 'error', reason });
  });
});

function voiceCallbacks(): VoiceChannelCallbacks {
  return {
    onPresenceChange: vi.fn(),
    onOffer: vi.fn(),
    onAnswer: vi.fn(),
    onIceCandidate: vi.fn(),
    onScreenShareStopped: vi.fn(),
  };
}

// Well past every step of Phoenix's rejoin backoff (1s, 2s, 5s, then every
// 10s — rejoinAfterMs in phoenix's socket.js), so a rejoin Phoenix had
// scheduled would certainly have been sent by then.
const WELL_PAST_REJOIN_BACKOFF_MS = 60_000;

// PROJECT_ARCHITECTURE.md §7 #12 — a join that fails outright must be left,
// or Phoenix keeps retrying it in the background (a later success = a ghost
// participant the client never set up audio for).
describe('joinVoiceChannel — a failed initial join is left, so Phoenix stops retrying it', () => {
  it('on an error reply: rejects with the server\'s reason and never re-sends the join', async () => {
    const pending = joinVoiceChannel('v1', voiceCallbacks());
    const ws = FakeWebSocket.latest();
    ws.open();

    ws.reply(ws.lastFrame('voice:v1', 'phx_join'), 'error', { reason: 'already_connected_elsewhere' });

    await expect(pending).rejects.toThrow('already_connected_elsewhere');
    expect(ws.frames('voice:v1', 'phx_leave')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(WELL_PAST_REJOIN_BACKOFF_MS);
    expect(FakeWebSocket.framesEverywhere('voice:v1', 'phx_join')).toHaveLength(1);
  });

  it('on a join timeout: rejects with the timeout reason and never re-sends the join', async () => {
    const pending = joinVoiceChannel('v1', voiceCallbacks());
    // Attached up front — the rejection lands mid-advance below, before a
    // later `await expect(...)` could attach a handler.
    const rejected = expect(pending).rejects.toThrow(VOICE_JOIN_TIMEOUT_REASON);
    FakeWebSocket.latest().open();

    await vi.advanceTimersByTimeAsync(PUSH_TIMEOUT_MS);
    await rejected;

    await vi.advanceTimersByTimeAsync(WELL_PAST_REJOIN_BACKOFF_MS);
    expect(FakeWebSocket.framesEverywhere('voice:v1', 'phx_join')).toHaveLength(1);
  });

  it('a fresh join after a failed one still works (the failed channel doesn\'t get in the way)', async () => {
    const first = joinVoiceChannel('v1', voiceCallbacks());
    const ws = FakeWebSocket.latest();
    ws.open();
    ws.reply(ws.lastFrame('voice:v1', 'phx_join'), 'error', { reason: 'already_connected_elsewhere' });
    await expect(first).rejects.toThrow();

    const second = joinVoiceChannel('v1', voiceCallbacks());
    ws.reply(ws.lastFrame('voice:v1', 'phx_join'), 'ok', { peers: ['peer-1'] });

    await expect(second).resolves.toMatchObject({ existingPeerIds: ['peer-1'] });
  });
});

// The other half of #12's fix: leave() must ONLY follow a failed *initial*
// join. Phoenix re-sends the very same join push on every automatic rejoin,
// so the hooks above fire again for those replies too — this proves an
// established call is still left entirely to Phoenix's own reconnect loop.
describe('joinVoiceChannel — an established call keeps Phoenix\'s automatic reconnect', () => {
  /** Joins successfully, then drops the connection and lets Phoenix
   * reconnect on its own — returning the new connection, on which Phoenix
   * has already re-sent the voice join by itself. */
  async function joinThenReconnect(): Promise<FakeWebSocket> {
    const pending = joinVoiceChannel('v1', voiceCallbacks());
    const first = FakeWebSocket.latest();
    first.open();
    first.reply(first.lastFrame('voice:v1', 'phx_join'), 'ok', { peers: [] });
    await pending;

    first.drop();
    // Phoenix's first reconnect attempt comes 10ms after a drop
    // (reconnectAfterMs in phoenix's socket.js).
    await vi.advanceTimersByTimeAsync(10);
    const second = FakeWebSocket.latest();
    expect(second).not.toBe(first);
    second.open();
    expect(second.frames('voice:v1', 'phx_join')).toHaveLength(1);
    return second;
  }

  it('a dropped connection is rejoined automatically, without any leave', async () => {
    const ws = await joinThenReconnect();

    ws.reply(ws.lastFrame('voice:v1', 'phx_join'), 'ok', { peers: [] });
    await vi.advanceTimersByTimeAsync(WELL_PAST_REJOIN_BACKOFF_MS);

    expect(FakeWebSocket.framesEverywhere('voice:v1', 'phx_leave')).toHaveLength(0);
    // Joined: no further join attempts were needed.
    expect(FakeWebSocket.framesEverywhere('voice:v1', 'phx_join')).toHaveLength(2);
  });

  it('a rejoin the server rejects (e.g. its old session not cleaned up yet) is retried, not left', async () => {
    const ws = await joinThenReconnect();

    ws.reply(ws.lastFrame('voice:v1', 'phx_join'), 'error', { reason: 'already_connected_elsewhere' });
    expect(ws.frames('voice:v1', 'phx_leave')).toHaveLength(0);

    // Phoenix's first rejoin backoff step.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ws.frames('voice:v1', 'phx_join')).toHaveLength(2);

    ws.reply(ws.lastFrame('voice:v1', 'phx_join'), 'ok', { peers: [] });
    await vi.advanceTimersByTimeAsync(WELL_PAST_REJOIN_BACKOFF_MS);
    expect(FakeWebSocket.framesEverywhere('voice:v1', 'phx_leave')).toHaveLength(0);
    expect(ws.frames('voice:v1', 'phx_join')).toHaveLength(2);
  });

  it('a rejoin that times out is retried, not left', async () => {
    const ws = await joinThenReconnect();

    // No reply to the rejoin at all. (Phoenix itself sends a phx_leave for
    // a timed-out join before retrying — channel.js's own joinPush timeout
    // hook — so the proof here is that it does go on to retry.)
    await vi.advanceTimersByTimeAsync(PUSH_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ws.frames('voice:v1', 'phx_join')).toHaveLength(2);

    ws.reply(ws.lastFrame('voice:v1', 'phx_join'), 'ok', { peers: [] });
    await vi.advanceTimersByTimeAsync(WELL_PAST_REJOIN_BACKOFF_MS);
    expect(ws.frames('voice:v1', 'phx_join')).toHaveLength(2);
  });
});
