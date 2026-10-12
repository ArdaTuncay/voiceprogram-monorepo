import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { useDMStore } from '../useDMStore';
import type { ChatMessage, DmRoom } from '../../types';

vi.mock('../../services/api', () => ({
  fetchDmRooms: vi.fn().mockResolvedValue({ data: [] }),
  fetchDmRoomMessages: vi.fn(),
  openDmRoom: vi.fn(),
  searchDmMessages: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('../../services/socket', () => ({
  sendDmMessage: vi.fn(),
  sendDmTyping: vi.fn(),
  toggleDmReaction: vi.fn(),
  editDmMessage: vi.fn(),
  deleteDmMessage: vi.fn(),
  sendDmMarkRead: vi.fn(),
}));

import { fetchDmRooms, openDmRoom } from '../../services/api';
import {
  sendDmMarkRead,
  deleteDmMessage,
  sendDmMessage,
  editDmMessage,
  toggleDmReaction,
} from '../../services/socket';
import type { PushFailureHandler } from '../../services/socket';
import { chatActionErrorMessage } from '../../utils/errorMessages';

function makeRoom(overrides: Partial<DmRoom> = {}): DmRoom {
  return {
    id: 'room-1',
    user_id: 'other-user',
    username: 'other',
    user_status: 'offline',
    unread_count: 0,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    content: 'hi',
    file_url: null,
    file_type: null,
    user_id: 'other-user',
    username: 'other',
    inserted_at: new Date().toISOString(),
    is_edited: false,
    reactions: [],
    is_deleted: false,
    ...overrides,
  };
}

describe('useDMStore — unread counts', () => {
  beforeEach(() => {
    useDMStore.getState().reset();
    vi.clearAllMocks();
  });

  describe('loadRooms', () => {
    it('seeds unreadCounts from each room’s backend-reported unread_count', async () => {
      vi.mocked(fetchDmRooms).mockResolvedValue({
        data: [makeRoom({ id: 'room-1', unread_count: 3 }), makeRoom({ id: 'room-2', unread_count: 0 })],
      });

      await useDMStore.getState().loadRooms();

      expect(useDMStore.getState().unreadCounts).toEqual({ 'room-1': 3, 'room-2': 0 });
    });
  });

  describe('openRoomWithUser', () => {
    it('adds an unreadCounts entry for the new room, then immediately zeroes it via the setActiveRoomId it triggers', async () => {
      // openRoomWithUser both opens (re)opens an existing room, which may
      // carry a real backend unread_count, *and* immediately makes it the
      // active room — setActiveRoomId's own optimistic zero (tested below)
      // is what the caller actually ends up seeing, since you're looking
      // at the room the moment it opens.
      vi.mocked(openDmRoom).mockResolvedValue({ data: makeRoom({ id: 'room-9', unread_count: 2 }) });

      await useDMStore.getState().openRoomWithUser('other-user');

      expect(useDMStore.getState().unreadCounts).toHaveProperty('room-9');
      expect(useDMStore.getState().unreadCounts['room-9']).toBe(0);
      expect(useDMStore.getState().activeRoomId).toBe('room-9');
    });
  });

  describe('handleNewDmMessage', () => {
    it('increments unreadCounts for a room that is not currently active', () => {
      useDMStore.setState({ rooms: [makeRoom({ id: 'room-1' })], activeRoomId: null, unreadCounts: {} });

      useDMStore.getState().handleNewDmMessage({
        ...makeMessage({ id: 'm1' }),
        dm_room_id: 'room-1',
      });
      useDMStore.getState().handleNewDmMessage({
        ...makeMessage({ id: 'm2' }),
        dm_room_id: 'room-1',
      });

      expect(useDMStore.getState().unreadCounts['room-1']).toBe(2);
    });

    it('immediately calls markRoomRead (mark_read) instead of incrementing when the room is active', () => {
      vi.mocked(sendDmMarkRead).mockImplementation((_seq, onSuccess) => onSuccess());
      useDMStore.setState({
        activeRoomId: 'room-1',
        messages: [makeMessage({ seq: 5 })],
        unreadCounts: { 'room-1': 0 },
      });

      useDMStore.getState().handleNewDmMessage({
        ...makeMessage({ id: 'm1', seq: 7 }),
        dm_room_id: 'room-1',
      });

      expect(sendDmMarkRead).toHaveBeenCalledWith(5, expect.any(Function));
      expect(useDMStore.getState().unreadCounts['room-1']).toBe(0);
    });
  });

  describe('markRoomRead', () => {
    it('sends the highest seq among loaded messages and zeroes the count on success', () => {
      vi.mocked(sendDmMarkRead).mockImplementation((_seq, onSuccess) => onSuccess());
      useDMStore.setState({
        messages: [makeMessage({ seq: 3 }), makeMessage({ seq: 10 }), makeMessage({ seq: 6 })],
        unreadCounts: { 'room-1': 4 },
      });

      useDMStore.getState().markRoomRead('room-1');

      expect(sendDmMarkRead).toHaveBeenCalledWith(10, expect.any(Function));
      expect(useDMStore.getState().unreadCounts['room-1']).toBe(0);
    });

    it('does not zero the count before the server confirms', () => {
      vi.mocked(sendDmMarkRead).mockImplementation(() => {});
      useDMStore.setState({ messages: [makeMessage({ seq: 10 })], unreadCounts: { 'room-1': 4 } });

      useDMStore.getState().markRoomRead('room-1');

      expect(useDMStore.getState().unreadCounts['room-1']).toBe(4);
    });

    it('no-ops when no messages are loaded yet', () => {
      useDMStore.setState({ messages: [], unreadCounts: { 'room-1': 4 } });

      useDMStore.getState().markRoomRead('room-1');

      expect(sendDmMarkRead).not.toHaveBeenCalled();
      expect(useDMStore.getState().unreadCounts['room-1']).toBe(4);
    });
  });

  describe('setActiveRoomId', () => {
    it('optimistically zeroes the room’s unread count immediately, without waiting on the server', () => {
      useDMStore.setState({ unreadCounts: { 'room-1': 4 } });

      useDMStore.getState().setActiveRoomId('room-1');

      expect(useDMStore.getState().unreadCounts['room-1']).toBe(0);
      expect(sendDmMarkRead).not.toHaveBeenCalled();
    });
  });

  describe('deleteMessage / handleMessageDeleted', () => {
    it('deleteMessage pushes to the socket (fire-and-forget, no local state change)', () => {
      useDMStore.getState().deleteMessage('m-a');

      expect(deleteDmMessage).toHaveBeenCalledWith('m-a', expect.any(Function));
    });

    it('handleMessageDeleted replaces only the matching message with the broadcasted (wiped) version', () => {
      useDMStore.setState({
        messages: [makeMessage({ id: 'm-a', content: 'oops' }), makeMessage({ id: 'm-b', content: 'still here' })],
      });

      useDMStore.getState().handleMessageDeleted(
        makeMessage({
          id: 'm-a',
          content: null as unknown as string,
          file_url: null,
          file_type: null,
          is_deleted: true,
        })
      );

      const [a, b] = useDMStore.getState().messages;
      expect(a.is_deleted).toBe(true);
      expect(a.content).toBeNull();
      expect(b.content).toBe('still here');
      expect(b.is_deleted).toBe(false);
    });
  });
});

// PROJECT_ARCHITECTURE.md §7 #11 — same contract as useChatStore's failed
// push feedback, scoped to the active DM room.
describe('useDMStore — failed push feedback', () => {
  function lastFailureHandler(push: unknown): PushFailureHandler {
    const call = (push as Mock).mock.calls.at(-1);
    if (!call) throw new Error('push was never called');
    return call.at(-1) as PushFailureHandler;
  }

  beforeEach(() => {
    useDMStore.getState().reset();
    useDMStore.setState({ activeRoomId: 'room-1' });
    vi.clearAllMocks();
  });

  it('a "blocked" send shows feedback and puts the text back, without touching messages', () => {
    const messages = [makeMessage({ id: 'm-a' })];
    useDMStore.setState({ messages, draft: 'hello' });

    useDMStore.getState().sendMessage();
    expect(useDMStore.getState().draft).toBe('');

    lastFailureHandler(sendDmMessage)({ kind: 'error', reason: 'blocked' });

    const state = useDMStore.getState();
    expect(state.actionError).toBe(chatActionErrorMessage('send', { kind: 'error', reason: 'blocked' }));
    expect(state.draft).toBe('hello');
    expect(state.messages).toBe(messages);
  });

  it('a timed-out send shows the neutral message and does NOT restore the text', () => {
    useDMStore.setState({ draft: 'hello' });
    useDMStore.getState().sendMessage();

    lastFailureHandler(sendDmMessage)({ kind: 'timeout' });

    expect(useDMStore.getState().actionError).toBe(chatActionErrorMessage('send', { kind: 'timeout' }));
    expect(useDMStore.getState().draft).toBe('');
  });

  it('drops feedback for a push made in a room the user has since left', () => {
    useDMStore.setState({ draft: 'hello' });
    useDMStore.getState().sendMessage();
    useDMStore.setState({ activeRoomId: 'room-2' });

    lastFailureHandler(sendDmMessage)({ kind: 'error', reason: 'rate_limited' });

    expect(useDMStore.getState().actionError).toBe('');
    expect(useDMStore.getState().draft).toBe('');
  });

  it('resetForRoomSwitch clears the feedback', () => {
    useDMStore.setState({ actionError: 'old feedback' });

    useDMStore.getState().resetForRoomSwitch();

    expect(useDMStore.getState().actionError).toBe('');
  });

  it.each([
    ['edit', editDmMessage, () => useDMStore.getState().editMessage('m-a', 'changed')],
    ['delete', deleteDmMessage, () => useDMStore.getState().deleteMessage('m-a')],
    ['react', toggleDmReaction, () => useDMStore.getState().toggleReaction('m-a', '👍')],
  ] as const)('a rejected %s shows feedback and leaves messages untouched', (action, push, run) => {
    const messages = [makeMessage({ id: 'm-a', content: 'original' })];
    useDMStore.setState({ messages });

    run();
    lastFailureHandler(push)({ kind: 'error', reason: 'rate_limited' });

    expect(useDMStore.getState().actionError).toBe(
      chatActionErrorMessage(action, { kind: 'error', reason: 'rate_limited' })
    );
    expect(useDMStore.getState().messages).toBe(messages);
  });
});
