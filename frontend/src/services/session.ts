import { useFriendStore } from '../stores/useFriendStore';
import { useServerStore } from '../stores/useServerStore';
import { useChatStore } from '../stores/useChatStore';
import { useDMStore } from '../stores/useDMStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useSessionStore } from '../stores/useSessionStore';
import { clearStoredSession } from './tokenStorage';

/**
 * Ends the session from outside React — called when the server has told us,
 * one way or another, that our token is no longer valid: a 401 on an
 * authenticated REST call (see api.ts's authedFetch) or the socket
 * repeatedly failing to even open (see socket.ts's onError wiring, for the
 * "rejected because the token is bad" case rather than a transient network
 * blip). Clears every Zustand store's user-scoped data — so nothing from
 * this session leaks into whatever comes next in the same tab, a fresh
 * login or a different account entirely — wipes the stored token/user, and
 * bumps useSessionStore so App.tsx falls back to the Auth screen (clearing
 * localStorage alone wouldn't trigger a re-render).
 *
 * Deliberately doesn't touch the socket itself (see services/socket.ts's
 * disconnectSocket) — both call sites already have their own reason to be
 * touching the socket right where they call this, and importing socket.ts
 * here would create a needless import cycle (socket.ts's own onError
 * handling is what calls this in the first place).
 */
export function forceLogout(): void {
  clearStoredSession();
  useFriendStore.getState().reset();
  useServerStore.getState().reset();
  useChatStore.getState().reset();
  useDMStore.getState().reset();
  useConnectionStore.getState().reset();
  useSessionStore.getState().triggerForcedLogout();
}
