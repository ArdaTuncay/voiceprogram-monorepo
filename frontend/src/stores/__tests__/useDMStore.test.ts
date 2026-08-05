import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  sendDmMarkRead: vi.fn(),
}));

import { fetchDmRooms, openDmRoom } from '../../services/api';
import { sendDmMarkRead } from '../../services/socket';

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
});
