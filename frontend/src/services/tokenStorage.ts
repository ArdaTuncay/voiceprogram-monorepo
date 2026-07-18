import type { User } from '../types';

// Split out of api.ts/App.tsx into their own module so both can be imported
// by services/session.ts (the forced-logout orchestrator) and services/
// socket.ts without creating an import cycle — api.ts and socket.ts each
// need to read the token, and session.ts needs to clear it, but neither of
// those two should have to import from each other just to reach this.
const TOKEN_STORAGE_KEY = 'voiceprogram_token';
const USER_STORAGE_KEY = 'voiceprogram_user';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function loadStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function storeUser(user: User): void {
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

/** Clears both the auth token and the cached user profile in one call — the
 * full "logged out" local state, used by both a manual logout and a forced
 * one (see services/session.ts's forceLogout). */
export function clearStoredSession(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
}
