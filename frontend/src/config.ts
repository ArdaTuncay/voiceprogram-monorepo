/**
 * Base URL of the backend. Empty in dev (and any environment where the
 * frontend is served through a proxy that forwards /api and /socket to the
 * backend on the same origin — e.g. Vite's dev proxy, or an ngrok tunnel).
 * Set VITE_API_URL when the frontend and backend are deployed as separate
 * origins (e.g. Vercel + Render).
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * Resolves a file URL returned by the backend for display. Local-disk
 * uploads come back as a backend-relative path (`/uploads/...`) that needs
 * API_BASE_URL prepended; S3/R2 uploads (see Backend.Uploads.S3) come back
 * already-absolute and must be left alone.
 */
export function resolveFileUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API_BASE_URL}${path}`;
}

/** Resolves the Phoenix socket URL from API_BASE_URL, or the page's own origin if unset. */
export function resolveSocketUrl(): string {
  if (API_BASE_URL) {
    const url = new URL(API_BASE_URL);
    const protocol = url.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${url.host}/socket`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/socket`;
}
