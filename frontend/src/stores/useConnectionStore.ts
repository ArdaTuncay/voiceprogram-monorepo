import { create } from 'zustand';

interface ConnectionStoreState {
  /** Whether the Phoenix socket is currently open — see services/socket.ts's
   * onOpen/onClose/onError wiring. Drives the "am I online" label in the
   * bottom-left user panel; there's no need to round-trip through the
   * backend to know your own connection state. */
  isConnected: boolean;
  /** True once the socket has successfully opened at least once this
   * session. Distinguishes "never connected yet" (the initial page load,
   * where briefly showing a reconnect banner or firing a resync would be
   * misleading) from "was connected, then dropped" — the case the
   * reconnect banner and useSocketSync's resync effect actually care about. */
  hasConnectedBefore: boolean;
  /** Bumped to Date.now() every time the socket re-opens after having been
   * open before — i.e. a genuine reconnect, not the first connect. Plain
   * channel rejoin (Phoenix's own built-in behavior) already re-syncs
   * anything driven by a channel's join reply or presence, but it can't
   * cover REST-backed state (friends list, member statuses) — useSocketSync
   * watches this value to trigger that resync explicitly. */
  reconnectedAt: number;
  setConnected: (connected: boolean) => void;
  /** Wipes this store back to its initial state — called on a forced logout
   * (see services/session.ts) so the next login's first connect isn't
   * mistaken for a "reconnect" (it would otherwise still see
   * hasConnectedBefore as true from the previous session). */
  reset: () => void;
}

export const useConnectionStore = create<ConnectionStoreState>((set, get) => ({
  isConnected: false,
  hasConnectedBefore: false,
  reconnectedAt: 0,
  setConnected: (connected) => {
    const wasConnectedBefore = get().hasConnectedBefore;
    set({
      isConnected: connected,
      hasConnectedBefore: wasConnectedBefore || connected,
      ...(connected && wasConnectedBefore ? { reconnectedAt: Date.now() } : {}),
    });
  },
  reset: () => set({ isConnected: false, hasConnectedBefore: false, reconnectedAt: 0 }),
}));
