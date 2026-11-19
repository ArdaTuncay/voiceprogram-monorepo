/** A page of the public website (see App). */
export type SitePage = 'home' | 'features';

/**
 * Which public site page this address shows, if any — never in the desktop
 * app, which is built with `--mode electron` and goes straight to its
 * sign-in screen.
 *
 * - `/` is the home page only while signed out; signed in it is Zircle.
 * - `/ozellikler` is the features page for everyone: it is only information,
 *   so a signed-in user following a shared link sees it too.
 */
export function sitePage(signedIn: boolean): SitePage | null {
  if (import.meta.env.MODE === 'electron') return null;
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return signedIn ? null : 'home';
  if (path === '/ozellikler') return 'features';
  return null;
}
