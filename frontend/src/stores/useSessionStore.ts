import { create } from 'zustand';

interface SessionStoreState {
  /** Bumped to Date.now() whenever the session is force-ended from outside
   * React — a 401 on an authenticated REST call, or the socket repeatedly
   * failing to even open because the server rejected our token (see
   * services/session.ts's forceLogout, called from api.ts and socket.ts).
   * App.tsx watches this to clear its own `user` state and fall back to the
   * Auth screen — clearing localStorage alone wouldn't trigger a re-render. */
  forcedLogoutAt: number;
  triggerForcedLogout: () => void;
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  forcedLogoutAt: 0,
  triggerForcedLogout: () => set({ forcedLogoutAt: Date.now() }),
}));
