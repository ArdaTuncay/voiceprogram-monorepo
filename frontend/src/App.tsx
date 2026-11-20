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
import { useServerStore } from './stores/useServerStore';
import HomePage from './site/HomePage';
import FeaturesPage from './site/FeaturesPage';
import DownloadPage from './site/DownloadPage';
import SignInPage from './site/SignInPage';
import InvitePage from './site/InvitePage';
import SecurityPage from './site/SecurityPage';
import SupportPage from './site/SupportPage';
import ChangelogPage from './site/ChangelogPage';
import NotFoundPage from './site/NotFoundPage';
import { PrivacyPage, TermsPage } from './site/LegalPages';
import { inviteCodeFromPath, sitePage, takePendingInvite } from './site/siteHome';
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

  // Bumped to re-render after this component moves the address itself
  // (history.replaceState doesn't trigger a render on its own).
  const [, setAddressVersion] = useState(0);

  function handleAuth(u: User) {
    storeUser(u);
    setUser(u);
  }

  // Signing in on a site page (/, /giris) opens Zircle in the same tab; the
  // address becomes the app's own, /, so a reload stays in the app.
  function handleSiteAuth(u: User) {
    window.history.replaceState(null, '', '/');
    handleAuth(u);
  }

  // A signed-in visitor joined from an invite page: open Zircle on /, where
  // the server store already has that server selected.
  function openApp() {
    window.history.replaceState(null, '', '/');
    setAddressVersion((v) => v + 1);
  }

  // An invite the visitor chose to join before signing in (see InvitePage):
  // join it as soon as there's a user, then reload the server list so it's
  // there even if the list was fetched before the join went through.
  useEffect(() => {
    if (!user) return;
    const code = takePendingInvite();
    if (!code) return;
    const servers = useServerStore.getState();
    void servers.joinServerByInvite(code).then((error) => {
      if (!error) void useServerStore.getState().loadServers();
    });
  }, [user]);

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
  switch (sitePage(user !== null)) {
    case 'home':
      return <HomePage onAuth={handleSiteAuth} />;
    case 'signin':
      return <SignInPage onAuth={handleSiteAuth} />;
    case 'features':
      return <FeaturesPage />;
    case 'download':
      return <DownloadPage />;
    case 'invite':
      return <InvitePage code={inviteCodeFromPath()} onJoined={openApp} />;
    case 'security':
      return <SecurityPage />;
    case 'support':
      return <SupportPage />;
    case 'changelog':
      return <ChangelogPage />;
    case 'privacy':
      return <PrivacyPage />;
    case 'terms':
      return <TermsPage />;
    case 'notfound':
      return <NotFoundPage />;
    case null:
      break;
  }

  // Only the desktop app gets here signed out: on the website every
  // signed-out address is a site page.
  if (!user) return <Auth onAuth={handleAuth} />;

  return <Chat user={user} onLogout={handleLogout} onUserUpdated={handleAuth} />;
}
