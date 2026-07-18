import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearStoredSession,
  getStoredToken,
  loadStoredUser,
  storeToken,
  storeUser,
} from '../tokenStorage';
import { forceLogout } from '../session';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useDMStore } from '../../stores/useDMStore';
import { useFriendStore } from '../../stores/useFriendStore';
import { useChatStore } from '../../stores/useChatStore';
import { useServerStore } from '../../stores/useServerStore';
import { useSessionStore } from '../../stores/useSessionStore';
import type { User } from '../../types';

const testUser: User = { id: 'u1', username: 'ardatuncay', email: 'arda@example.com' };

describe('tokenStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing has been stored yet', () => {
    expect(getStoredToken()).toBeNull();
    expect(loadStoredUser()).toBeNull();
  });

  it('round-trips a token through storeToken/getStoredToken', () => {
    storeToken('my-jwt-token');
    expect(getStoredToken()).toBe('my-jwt-token');
  });

  it('round-trips a user through storeUser/loadStoredUser', () => {
    storeUser(testUser);
    expect(loadStoredUser()).toEqual(testUser);
  });

  it('loadStoredUser returns null instead of throwing on corrupted JSON', () => {
    localStorage.setItem('voiceprogram_user', '{not valid json');
    expect(loadStoredUser()).toBeNull();
  });

  it('clearStoredSession removes both the token and the user', () => {
    storeToken('my-jwt-token');
    storeUser(testUser);

    clearStoredSession();

    expect(getStoredToken()).toBeNull();
    expect(loadStoredUser()).toBeNull();
  });
});

describe('session.forceLogout', () => {
  beforeEach(() => {
    localStorage.clear();
    storeToken('my-jwt-token');
    storeUser(testUser);

    // Dirty every store forceLogout is responsible for resetting, so the
    // assertions below actually prove it wipes them rather than finding
    // them already at their initial values.
    useServerStore.setState({ activeServerId: 'server-1' });
    useChatStore.setState({ draft: 'unsent message' });
    useDMStore.setState({ activeRoomId: 'room-1' });
    useFriendStore.setState({ error: 'stale error' });
    useConnectionStore.setState({ isConnected: true, hasConnectedBefore: true });
    useSessionStore.setState({ forcedLogoutAt: 0 });
  });

  it('clears the stored token and user', () => {
    forceLogout();

    expect(getStoredToken()).toBeNull();
    expect(loadStoredUser()).toBeNull();
  });

  it('resets every user-scoped store back to its initial state', () => {
    forceLogout();

    expect(useServerStore.getState().activeServerId).toBeNull();
    expect(useChatStore.getState().draft).toBe('');
    expect(useDMStore.getState().activeRoomId).toBeNull();
    expect(useFriendStore.getState().error).toBe('');
    expect(useConnectionStore.getState()).toMatchObject({
      isConnected: false,
      hasConnectedBefore: false,
    });
  });

  it('bumps useSessionStore so App.tsx can fall back to the Auth screen', () => {
    forceLogout();

    expect(useSessionStore.getState().forcedLogoutAt).toBeGreaterThan(0);
  });
});
