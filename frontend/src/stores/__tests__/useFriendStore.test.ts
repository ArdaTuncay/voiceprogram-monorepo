import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFriendStore } from '../useFriendStore';
import type { Friendship } from '../../types';

vi.mock('../../services/api', () => ({
  fetchFriends: vi.fn(),
  sendFriendRequest: vi.fn(),
  acceptFriendRequest: vi.fn(),
  removeFriendship: vi.fn(),
  fetchBlockedUsers: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
}));

import { blockUser, fetchBlockedUsers, unblockUser } from '../../services/api';

function makeFriendship(overrides: Partial<Friendship> = {}): Friendship {
  return {
    id: 'f1',
    status: 'accepted',
    direction: 'outgoing',
    user_id: 'u2',
    username: 'someone',
    user_status: 'offline',
    ...overrides,
  };
}

describe('useFriendStore — blocking', () => {
  beforeEach(() => {
    useFriendStore.getState().reset();
    vi.clearAllMocks();
  });

  describe('loadBlockedUsers', () => {
    it('populates blockedUsers on success', async () => {
      vi.mocked(fetchBlockedUsers).mockResolvedValue({
        data: [{ user_id: 'u2', username: 'someone' }],
      });

      await useFriendStore.getState().loadBlockedUsers();

      expect(useFriendStore.getState().blockedUsers).toEqual([
        { user_id: 'u2', username: 'someone' },
      ]);
    });

    it('leaves blockedUsers untouched on error', async () => {
      vi.mocked(fetchBlockedUsers).mockResolvedValue({ error: 'network error' });

      await useFriendStore.getState().loadBlockedUsers();

      expect(useFriendStore.getState().blockedUsers).toEqual([]);
    });
  });

  describe('blockUser', () => {
    it('on success, drops any friendship with that user and refreshes the blocked list', async () => {
      useFriendStore.setState({
        friendships: [makeFriendship({ id: 'f1', user_id: 'u2' }), makeFriendship({ id: 'f2', user_id: 'u3' })],
      });
      vi.mocked(blockUser).mockResolvedValue({ data: undefined });
      vi.mocked(fetchBlockedUsers).mockResolvedValue({
        data: [{ user_id: 'u2', username: 'someone' }],
      });

      const error = await useFriendStore.getState().blockUser('u2');

      expect(error).toBeUndefined();
      expect(blockUser).toHaveBeenCalledWith('u2');
      expect(useFriendStore.getState().friendships).toEqual([makeFriendship({ id: 'f2', user_id: 'u3' })]);
      expect(useFriendStore.getState().blockedUsers).toEqual([{ user_id: 'u2', username: 'someone' }]);
    });

    it('returns the backend error and leaves friendships untouched on failure', async () => {
      useFriendStore.setState({ friendships: [makeFriendship({ id: 'f1', user_id: 'u2' })] });
      vi.mocked(blockUser).mockResolvedValue({ error: 'Kendinizi engelleyemezsiniz' });

      const error = await useFriendStore.getState().blockUser('u2');

      expect(error).toBe('Kendinizi engelleyemezsiniz');
      expect(useFriendStore.getState().friendships).toEqual([makeFriendship({ id: 'f1', user_id: 'u2' })]);
    });
  });

  describe('unblockUser', () => {
    it('on success, removes the user from the local blocked list', async () => {
      useFriendStore.setState({
        blockedUsers: [
          { user_id: 'u2', username: 'someone' },
          { user_id: 'u3', username: 'another' },
        ],
      });
      vi.mocked(unblockUser).mockResolvedValue({ data: undefined });

      const error = await useFriendStore.getState().unblockUser('u2');

      expect(error).toBeUndefined();
      expect(unblockUser).toHaveBeenCalledWith('u2');
      expect(useFriendStore.getState().blockedUsers).toEqual([{ user_id: 'u3', username: 'another' }]);
    });

    it('returns the backend error and leaves the blocked list untouched on failure', async () => {
      useFriendStore.setState({ blockedUsers: [{ user_id: 'u2', username: 'someone' }] });
      vi.mocked(unblockUser).mockResolvedValue({ error: 'Bu kullanıcıyı engellemediniz' });

      const error = await useFriendStore.getState().unblockUser('u2');

      expect(error).toBe('Bu kullanıcıyı engellemediniz');
      expect(useFriendStore.getState().blockedUsers).toEqual([{ user_id: 'u2', username: 'someone' }]);
    });
  });

  describe('reset', () => {
    it('clears blockedUsers along with everything else', () => {
      useFriendStore.setState({ blockedUsers: [{ user_id: 'u2', username: 'someone' }] });
      useFriendStore.getState().reset();
      expect(useFriendStore.getState().blockedUsers).toEqual([]);
    });
  });
});
