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
  sendDmMessage,
  shout,
  toggleDmReaction,
  toggleReaction,
} from '../socket';
import type { ChannelCallbacks } from '../socket';

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
