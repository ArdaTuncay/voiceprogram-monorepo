import type {
  AuthResponse,
  Channel,
  ChannelType,
  Server,
  ServerMember,
  Invite,
  UploadResult,
  ApiError,
  Friendship,
  DmRoom,
  LinkPreview,
  MessagesPage,
  SearchFilters,
  SearchResultsPage,
} from '../types';
import { API_BASE_URL } from '../config';
import { getStoredToken, storeToken } from './tokenStorage';
import { forceLogout } from './session';
import { disconnectSocket } from './socket';

interface ApiResult<T> {
  data?: T;
  error?: string;
}

async function post<T>(path: string, body: Record<string, string>): Promise<ApiResult<T>> {
  try {
    const resp = await fetch(`${API_BASE_URL}/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await resp.json();
    if (!resp.ok) {
      const err = json as ApiError;
      if (err.errors) {
        const messages = Object.entries(err.errors).flatMap(([field, errs]) =>
          errs.map((e) => `${field} ${e}`)
        );
        return { error: messages.join(', ') };
      }
      return { error: err.error ?? 'An error occurred' };
    }
    return { data: json as T };
  } catch {
    return { error: 'Network error — is the backend running on port 4000?' };
  }
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const resp = await fetch(`${API_BASE_URL}/api${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${getStoredToken() ?? ''}` },
    });

    // Every call through here hits an :authenticated-pipeline route (see
    // router.ex) — register/login go through the plain post() helper below
    // instead and never reach this function, so there's no unauthenticated
    // endpoint to accidentally catch here. A 401 means the token we sent is
    // no longer valid (expired past its 24h lifetime, or revoked by
    // logout_all) — no retry or per-call error string will fix that, so end
    // the session outright rather than surfacing a confusing one-off error
    // and leaving the user stuck looking logged-in.
    if (resp.status === 401) {
      disconnectSocket();
      forceLogout();
      return { error: 'Oturum süresi doldu, lütfen tekrar giriş yapın.' };
    }

    // No body to parse on a 204 (e.g. the delete/kick endpoints below).
    if (resp.status === 204) {
      return { data: undefined };
    }
    const json = await resp.json();
    if (!resp.ok) {
      const err = json as ApiError;
      if (err.errors) {
        const messages = Object.entries(err.errors).flatMap(([field, errs]) =>
          errs.map((e) => `${field} ${e}`)
        );
        return { error: messages.join(', ') };
      }
      return { error: err.error ?? 'An error occurred' };
    }
    return { data: json as T };
  } catch {
    return { error: 'Network error — is the backend running on port 4000?' };
  }
}

function authedGet<T>(path: string): Promise<ApiResult<T>> {
  return authedFetch<T>(path);
}

function authedPost<T>(path: string, body: Record<string, string>): Promise<ApiResult<T>> {
  return authedFetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authedPut<T>(path: string, body: Record<string, string>): Promise<ApiResult<T>> {
  return authedFetch<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authedDelete<T>(path: string): Promise<ApiResult<T>> {
  return authedFetch<T>(path, { method: 'DELETE' });
}

export async function registerUser(
  username: string,
  email: string,
  password: string
): Promise<ApiResult<AuthResponse>> {
  const result = await post<AuthResponse>('/users/register', { username, email, password });
  if (result.data) storeToken(result.data.token);
  return result;
}

export async function loginUser(
  email: string,
  password: string
): Promise<ApiResult<AuthResponse>> {
  const result = await post<AuthResponse>('/users/login', { email, password });
  if (result.data) storeToken(result.data.token);
  return result;
}

export function fetchServers(): Promise<ApiResult<Server[]>> {
  return authedGet<Server[]>('/servers');
}

export function createServer(name: string): Promise<ApiResult<Server>> {
  return authedPost<Server>('/servers', { name });
}

export function fetchServerChannels(serverId: string): Promise<ApiResult<Channel[]>> {
  return authedGet<Channel[]>(`/servers/${serverId}/channels`);
}

export function fetchServerMembers(serverId: string): Promise<ApiResult<ServerMember[]>> {
  return authedGet<ServerMember[]>(`/servers/${serverId}/members`);
}

/** Fetches a page of channel message history — the most recent 50, or (with
 * `beforeId`) the 50 immediately preceding that message, for infinite-scroll
 * paging upward through older history. */
export function fetchChannelMessages(
  serverId: string,
  channelId: string,
  beforeId?: string
): Promise<ApiResult<MessagesPage>> {
  const query = beforeId ? `?before=${encodeURIComponent(beforeId)}` : '';
  return authedGet<MessagesPage>(`/servers/${serverId}/channels/${channelId}/messages${query}`);
}

/** Creates a text, voice, or category channel in a server. Owner only.
 * `parentId` groups a text/voice channel under an existing category. */
export function createChannel(
  serverId: string,
  name: string,
  type: ChannelType,
  parentId?: string | null
): Promise<ApiResult<Channel>> {
  const body: Record<string, string> = { name, type };
  if (parentId) body.parent_id = parentId;
  return authedPost<Channel>(`/servers/${serverId}/channels`, body);
}

export interface ChannelPositionUpdate {
  id: string;
  parent_id: string | null;
  position: number;
}

/** Bulk-updates channels' parent/position — moving into/out of a category,
 * or reordering siblings. Owner only. */
export function updateChannelPositions(
  serverId: string,
  updates: ChannelPositionUpdate[]
): Promise<ApiResult<Channel[]>> {
  return authedFetch<Channel[]>(`/servers/${serverId}/channels/positions`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channels: updates }),
  });
}

/** Renames a server. Owner only — the backend rejects it otherwise. */
export function updateServer(serverId: string, name: string): Promise<ApiResult<Server>> {
  return authedPut<Server>(`/servers/${serverId}`, { name });
}

/** Permanently deletes a server. Owner only. */
export function deleteServer(serverId: string): Promise<ApiResult<void>> {
  return authedDelete<void>(`/servers/${serverId}`);
}

/** Leaves a server. Any member except the owner — the backend rejects the owner. */
export function leaveServer(serverId: string): Promise<ApiResult<void>> {
  return authedDelete<void>(`/servers/${serverId}/leave`);
}

/** Permanently deletes a text or voice channel. Server owner only. */
export function deleteChannel(channelId: string): Promise<ApiResult<void>> {
  return authedDelete<void>(`/channels/${channelId}`);
}

/** Kicks a member from a server. Server owner only. */
export function kickMember(serverId: string, userId: string): Promise<ApiResult<void>> {
  return authedDelete<void>(`/servers/${serverId}/members/${userId}`);
}

export function createInvite(serverId: string): Promise<ApiResult<Invite>> {
  return authedPost<Invite>(`/servers/${serverId}/invites`, {});
}

/** Lists every invite ever created for a server (active or not). Owner only. */
export function fetchServerInvites(serverId: string): Promise<ApiResult<Invite[]>> {
  return authedGet<Invite[]>(`/servers/${serverId}/invites`);
}

/** Revokes (deletes) an invite so its code can no longer be redeemed. Owner only. */
export function revokeInvite(serverId: string, inviteId: string): Promise<ApiResult<void>> {
  return authedDelete<void>(`/servers/${serverId}/invites/${inviteId}`);
}

export function acceptInvite(code: string): Promise<ApiResult<Server>> {
  return authedPost<Server>(`/invites/${code}/accept`, {});
}

/** Uploads a chat attachment as multipart/form-data; the browser sets the boundary header itself. */
export function uploadFile(file: File): Promise<ApiResult<UploadResult>> {
  const formData = new FormData();
  formData.append('file', file);
  return authedFetch<UploadResult>('/upload', { method: 'POST', body: formData });
}

/** Lists every friendship/request involving the current user (friends, pending, blocked-by-you). */
export function fetchFriends(): Promise<ApiResult<Friendship[]>> {
  return authedGet<Friendship[]>('/friends');
}

/** Sends a friend request by exact username. */
export function sendFriendRequest(username: string): Promise<ApiResult<Friendship>> {
  return authedPost<Friendship>('/friends/request', { username });
}

/** Accepts a pending incoming request, by the friendship row's own id. */
export function acceptFriendRequest(friendshipId: string): Promise<ApiResult<Friendship>> {
  return authedPost<Friendship>('/friends/accept', { id: friendshipId });
}

/** Cancels an outgoing request, rejects an incoming one, or removes an existing friendship. */
export function removeFriendship(friendshipId: string): Promise<ApiResult<void>> {
  return authedDelete<void>(`/friends/${friendshipId}`);
}

/** Lists every DM room the current user is part of. */
export function fetchDmRooms(): Promise<ApiResult<DmRoom[]>> {
  return authedGet<DmRoom[]>('/dms');
}

/** Opens (or returns the existing) DM room with a friend, by user id. */
export function openDmRoom(userId: string): Promise<ApiResult<DmRoom>> {
  return authedPost<DmRoom>('/dms', { user_id: userId });
}

/** Fetches a page of DM room message history — same shape/paging as
 * `fetchChannelMessages`. */
export function fetchDmRoomMessages(roomId: string, beforeId?: string): Promise<ApiResult<MessagesPage>> {
  const query = beforeId ? `?before=${encodeURIComponent(beforeId)}` : '';
  return authedGet<MessagesPage>(`/dms/${roomId}/messages${query}`);
}

function buildSearchQuery(filters: SearchFilters): string {
  const params = new URLSearchParams();
  if (filters.query) params.set('query', filters.query);
  if (filters.author_id) params.set('author_id', filters.author_id);
  if (filters.has_file) params.set('has_file', 'true');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Full-text search over a channel's message history — see
 * `Backend.Chat.search_messages/2`. Not paginated; the backend caps the
 * result list at a fixed size. */
export function searchChannelMessages(
  channelId: string,
  filters: SearchFilters
): Promise<ApiResult<SearchResultsPage>> {
  return authedGet<SearchResultsPage>(`/channels/${channelId}/search${buildSearchQuery(filters)}`);
}

/** Full-text search over a DM room's message history — see
 * `Backend.DirectMessages.search_dm_messages/2`. Same shape/caveats as
 * `searchChannelMessages`. */
export function searchDmMessages(
  roomId: string,
  filters: SearchFilters
): Promise<ApiResult<SearchResultsPage>> {
  return authedGet<SearchResultsPage>(`/dm_rooms/${roomId}/search${buildSearchQuery(filters)}`);
}

/** Fetches OpenGraph metadata for a chat link-preview card. */
export function fetchLinkPreview(url: string): Promise<ApiResult<LinkPreview>> {
  return authedGet<LinkPreview>(`/utils/preview?url=${encodeURIComponent(url)}`);
}
