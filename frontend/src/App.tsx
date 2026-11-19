import { useEffect, useState } from 'react';
import type { User } from './types';
import { getStoredToken, loadStoredUser, storeUser } from './services/tokenStorage';
import { forceLogout } from './services/session';
import { useSessionStore } from './stores/useSessionStore';
import { logoutCurrentSession, renewSessionToken } from './services/api';
import Auth from './components/Auth';
import Chat from './components/Chat';
import VerifyEmailPage from './components/VerifyEmailPage';
import ResetPasswordPage from './components/ResetPasswordPage';
import ConfirmEmailChangePage from './components/ConfirmEmailChangePage';
import HomePage from './site/HomePage';
import FeaturesPage from './site/FeaturesPage';
import { sitePage } from './site/siteHome';
import './App.css';

const VERIFY_EMAIL_PATH_PREFIX = '/verify-email/';
const RESET_PASSWORD_PATH_PREFIX = '/reset-password/';
const CONFIRM_EMAIL_PATH_PREFIX = '/confirm-email/';

// A stored user with no token (or vice versa) isn't a valid session.
function loadSession(): User | null {
  return getStoredToken() ? loadStoredUser() : null;
}

// Session tokens last 7 days (Backend.Accounts); an open app renews its own
// so an active user is never signed out mid-use, and only a device left
// unused for a week has to log in again.
export const SESSION_RENEW_INTERVAL_MS = 12 * 60 * 60 * 1000;

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
    // Sent with the current token before it's cleared below (authedFetch
    // reads it synchronously); not awaited — signing out here never waits
    // on the network.
    void logoutCurrentSession();
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

  // Renew right away (the stored token may be days old) and then every
  // SESSION_RENEW_INTERVAL_MS while signed in. The socket reads the stored
  // token on every (re)connect, so it picks the new one up by itself.
  useEffect(() => {
    if (!user) return;
    void renewSessionToken();
    const timer = window.setInterval(() => void renewSessionToken(), SESSION_RENEW_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [user]);

  // No client router in this app (see the rest of this component) — a mail
  // client opens this path directly, so it's matched off the raw URL,
  // entirely isolated from the user-state branches below (nothing here
  // reads/writes `user` or any store).
  if (window.location.pathname.startsWith(VERIFY_EMAIL_PATH_PREFIX)) {
    const token = window.location.pathname.slice(VERIFY_EMAIL_PATH_PREFIX.length);
    return <VerifyEmailPage token={token} />;
  }

  // Same mail-client-opened pattern as /verify-email/ above.
  if (window.location.pathname.startsWith(RESET_PASSWORD_PATH_PREFIX)) {
    const token = window.location.pathname.slice(RESET_PASSWORD_PATH_PREFIX.length);
    return <ResetPasswordPage token={token} />;
  }

  // Same mail-client-opened pattern as /verify-email/ above.
  if (window.location.pathname.startsWith(CONFIRM_EMAIL_PATH_PREFIX)) {
    const token = window.location.pathname.slice(CONFIRM_EMAIL_PATH_PREFIX.length);
    return <ConfirmEmailChangePage token={token} />;
  }

  // The public website's pages (see site/siteHome.ts). The desktop app
  // (served from file://, built with --mode electron) never shows them.
  const site = sitePage(user !== null);
  if (site === 'features') return <FeaturesPage />;

  if (!user) {
    // Signed out at the root of the website: the public home page, whose
    // sign-in card opens the app right here once it calls handleAuth. Any
    // other signed-out path gets the app's own sign-in screen.
    if (site === 'home') return <HomePage onAuth={handleAuth} />;
    return <Auth onAuth={handleAuth} />;
  }

  return <Chat user={user} onLogout={handleLogout} onUserUpdated={handleAuth} />;
}
