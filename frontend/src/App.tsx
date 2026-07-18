import { useEffect, useState } from 'react';
import type { User } from './types';
import { getStoredToken, loadStoredUser, storeUser } from './services/tokenStorage';
import { forceLogout } from './services/session';
import { useSessionStore } from './stores/useSessionStore';
import Auth from './components/Auth';
import Chat from './components/Chat';
import './App.css';

// A stored user with no token (or vice versa) isn't a valid session.
function loadSession(): User | null {
  return getStoredToken() ? loadStoredUser() : null;
}

export default function App() {
  const [user, setUser] = useState<User | null>(loadSession);
  const forcedLogoutAt = useSessionStore((s) => s.forcedLogoutAt);

  function handleAuth(u: User) {
    storeUser(u);
    setUser(u);
  }

  // Reuses the exact same cleanup a forced logout (401, revoked token) goes
  // through — clears the token/user from localStorage *and* every Zustand
  // store's reset() action — instead of just wiping localStorage. Without
  // this, a manual logout left every store's data (servers, channels,
  // messages, friends, DMs) sitting in memory; a different account logging
  // in on the same tab afterward would briefly render the previous user's
  // data before fresh fetches overwrote it. Calling setUser(null) here too
  // (rather than relying solely on the forcedLogoutAt effect below) makes
  // the transition immediate rather than waiting on a second render.
  function handleLogout() {
    forceLogout();
    setUser(null);
  }

  // A 401 on a REST call or the socket getting rejected for an invalid
  // token (see services/session.ts's forceLogout, called from api.ts and
  // socket.ts) already clears the stored token/user and every other store —
  // this just has to catch up React's own `user` state, since nothing else
  // would trigger the fall-back-to-Auth re-render. Guarded on the initial
  // 0 value so this never fires on mount, only on an actual forced logout.
  useEffect(() => {
    if (!forcedLogoutAt) return;
    setUser(null);
  }, [forcedLogoutAt]);

  if (!user) {
    return <Auth onAuth={handleAuth} />;
  }

  return <Chat user={user} onLogout={handleLogout} />;
}
