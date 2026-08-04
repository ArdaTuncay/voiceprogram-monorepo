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
