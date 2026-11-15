import type { MemberRole, Server } from '../types';

/** My role in a server — `my_role` from the API, falling back to owner_id. */
export function myRoleIn(server: Server | undefined, userId: string): MemberRole | undefined {
  if (!server) return undefined;
  return server.my_role ?? (server.owner_id === userId ? 'owner' : 'member');
}

export function isModerator(role: MemberRole | undefined): boolean {
  return role === 'owner' || role === 'moderator';
}

/**
 * Mirrors Backend.Servers.can_moderate?/3: the owner can act on anyone but
 * themselves; a moderator only on regular members (an unknown role counts
 * as a regular member — the server re-checks either way).
 */
export function canModerate(myRole: MemberRole | undefined, targetRole: MemberRole | undefined): boolean {
  if (myRole === 'owner') return targetRole !== 'owner';
  if (myRole === 'moderator') return targetRole !== 'owner' && targetRole !== 'moderator';
  return false;
}
