/** Whether a signed-out visitor here gets the public home page (see App):
 * only at the root of the website — never in the desktop app, which is
 * built with `--mode electron` and goes straight to its sign-in screen. */
export function showsSiteHome(): boolean {
  return import.meta.env.MODE !== 'electron' && window.location.pathname === '/';
}
