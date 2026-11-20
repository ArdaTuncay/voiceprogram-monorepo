/** A page of the public website (see App). */
export type SitePage =
  | 'home'
  | 'features'
  | 'download'
  | 'signin'
  | 'invite'
  | 'security'
  | 'support'
  | 'changelog'
  | 'privacy'
  | 'terms'
  | 'notfound';

/** Information pages: shown to everyone, signed in or not. */
const INFO_PAGES: Record<string, SitePage> = {
  '/ozellikler': 'features',
  '/indir': 'download',
  '/guvenlik': 'security',
  '/destek': 'support',
  '/yenilikler': 'changelog',
  '/gizlilik': 'privacy',
  '/kosullar': 'terms',
};

const INVITE_PREFIX = '/davet/';

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

/**
 * Which public site page this address shows, if any — never in the desktop
 * app, which is built with `--mode electron` and goes straight to its
 * sign-in screen.
 *
 * - `/` is the home page while signed out; signed in it is Zircle.
 * - The information pages and `/davet/<code>` are for everyone, so a
 *   signed-in user following a shared link sees them too.
 * - `/giris` is the sign-in page while signed out; signed in it is Zircle.
 * - Any other address is the 404 page while signed out; signed in it is
 *   Zircle, as before the site existed.
 */
export function sitePage(signedIn: boolean): SitePage | null {
  if (import.meta.env.MODE === 'electron') return null;
  const path = currentPath();
  if (path === '/') return signedIn ? null : 'home';
  if (INFO_PAGES[path]) return INFO_PAGES[path];
  if (inviteCodeFromPath()) return 'invite';
  if (path === '/giris') return signedIn ? null : 'signin';
  return signedIn ? null : 'notfound';
}

/** The invite code in a `/davet/<code>` address, or '' anywhere else. */
export function inviteCodeFromPath(): string {
  const path = currentPath();
  if (!path.startsWith(INVITE_PREFIX)) return '';
  const code = path.slice(INVITE_PREFIX.length);
  return /^[A-Za-z0-9_-]+$/.test(code) ? code : '';
}

// An invite the visitor chose to join before signing in (see InvitePage):
// App joins it as soon as there is a user. sessionStorage, so it never
// outlives the tab that clicked "Tarayıcıda katıl".
const PENDING_INVITE_KEY = 'zircle.pendingInvite';

export function savePendingInvite(code: string): void {
  try {
    sessionStorage.setItem(PENDING_INVITE_KEY, code);
  } catch {
    // Storage blocked: the visitor can open the invite link again after signing in.
  }
}

/** Returns the pending invite code (if any) and forgets it. */
export function takePendingInvite(): string | null {
  try {
    const code = sessionStorage.getItem(PENDING_INVITE_KEY);
    sessionStorage.removeItem(PENDING_INVITE_KEY);
    return code;
  } catch {
    return null;
  }
}
