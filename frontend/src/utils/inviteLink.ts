// The website's address for invite links. In the browser that's simply this
// page's origin; the desktop app runs from file://, so it uses the site's
// public address (VITE_SITE_URL, or the production site by default).
const DEFAULT_SITE_URL = 'https://zircle.vercel.app';

/** The shareable link for an invite code: <site>/davet/<code> (see site/InvitePage). */
export function inviteLink(code: string): string {
  const origin = /^https?:$/.test(window.location.protocol)
    ? window.location.origin
    : (import.meta.env.VITE_SITE_URL ?? DEFAULT_SITE_URL);
  return `${origin.replace(/\/+$/, '')}/davet/${code}`;
}
