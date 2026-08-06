import type { ChatMessage } from './types';

/** Discord-style consecutive-message grouping: true when `current` should
 * render without repeating the previous message's avatar/name/timestamp —
 * same author, same UTC minute. Compares `inserted_at` as raw ISO-string
 * prefixes (`"YYYY-MM-DDTHH:MM"`) rather than parsing `Date`s and calling
 * `getMinutes()`/`getHours()`, so there's no local-timezone conversion
 * that could shift which "minute" two timestamps land in. Callers only
 * ever pass adjacent elements of an already-chronological message list,
 * so "same author, same minute" here already implies "nothing from
 * anyone else arrived in between" — no separate check needed for that. */
export function shouldGroupMessages(prev: ChatMessage | undefined, current: ChatMessage): boolean {
  if (!prev) return false;
  if (prev.user_id !== current.user_id) return false;
  return prev.inserted_at.slice(0, 16) === current.inserted_at.slice(0, 16);
}

/** Deterministic color per user from a small Discord-like palette. */
export function userColor(userId: string): string {
  const palette = [
    '#7289da', '#43b581', '#faa61a', '#f04747',
    '#1abc9c', '#e91e63', '#9b59b6', '#e67e22',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

export function initials(name: string | null): string {
  if (!name) return '?';
  return name.slice(0, 2).toUpperCase();
}

/** Unlike `initials` (first two chars of one name), this takes the first
 * letter of each of the first two words — for multi-word server names. */
export function serverInitials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
  return (letters || '?').toUpperCase();
}
