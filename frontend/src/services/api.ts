import { currentLanguage, t } from '../i18n';
import type {
  ActiveSession,
  AuthResponse,
  TwoFactorChallenge,
  TwoFactorSetup,
  TwoFactorStatus,
  Channel,
  ChannelType,
  MemberRole,
  ReportReason,
  ReportTarget,
  Server,
  ServerReport,
  DmReport,
  ServerMember,
  Invite,
  UploadResult,
  ApiError,
  Friendship,
  DmRoom,
  LinkPreview,
  MessageResponse,
  MessagesPage,
  RegisterResponse,
  SearchFilters,
  SearchResultsPage,
  TurnCredentialsResponse,
  User,
  BlockedUser,
  FriendRequestPrivacy,
} from '../types';
import { API_BASE_URL } from '../config';
import { getStoredToken, storeToken } from './tokenStorage';
import { forceLogout } from './session';
import { disconnectSocket } from './socket';
import {
  AUTH_REQUEST_ERRORS,
  changesetErrorsMessage,
  httpStatusErrorMessage,
} from '../utils/errorMessages';

interface ApiResult<T> {
  data?: T;
  error?: string;
}

/** How long post() waits for a response before giving up — generous on
 * purpose, since a backend on a sleeping free-tier instance can take tens
 * of seconds to cold-start on the first request. */
export const AUTH_REQUEST_TIMEOUT_MS = 30_000;

class RequestTimeoutError extends Error {}

/**
 * Unauthenticated POST — register, login and resend-verification. Always
 * resolves, never rejects, and never stays pending past
 * AUTH_REQUEST_TIMEOUT_MS: `fetch` has no timeout of its own, so a request
 * that never got a response (a stalled connection, a cold-starting backend)
 * used to leave Auth's submit button stuck on "Please wait…" with no error
 * shown — PROJECT_ARCHITECTURE.md §7 item 15. The deadline is raced against
 * the request rather than relying on the abort alone: aborting is what
 * actually cancels the request, but the race is what guarantees this
 * function's own await settles on time no matter how the request behaves.
 */
/** Asks the backend to answer in the UI language (see BackendWeb.LocalePlug):
 * its error/info messages and the account emails a request triggers. */
function languageHeader(): Record<string, string> {
  return { 'Accept-Language': currentLanguage() };
}

async function post<T>(path: string, body: Record<string, string>): Promise<ApiResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError());
    }, AUTH_REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([sendPost<T>(path, body, controller.signal), deadline]);
  } catch (err) {
    return {
      error:
        err instanceof RequestTimeoutError ? AUTH_REQUEST_ERRORS.timeout : AUTH_REQUEST_ERRORS.network,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function sendPost<T>(
  path: string,
  body: Record<string, string>,
  signal: AbortSignal
): Promise<ApiResult<T>> {
  const resp = await fetch(`${API_BASE_URL}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...languageHeader() },
    body: JSON.stringify(body),
    signal,
  });

  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    // Not the JSON every backend response carries (see
    // httpStatusErrorMessage for what does this) — used to fall through to
    // the outer catch and be reported as a network error instead.
    return { error: httpStatusErrorMessage(resp.status) };
  }

  if (!resp.ok) {
    // Checked before reading the body's own `error`: this is the one status
    // where the user's next step (wait, then retry) is known without reading
    // it, so it gets the same wording as the client-side rate-limit copy.
    if (resp.status === 429) return { error: AUTH_REQUEST_ERRORS.rateLimited };
    const err = json as ApiError;
    if (err.errors) return { error: changesetErrorsMessage(err.errors) };
    return { error: err.error ?? t('Bir hata oluştu') };
  }
  return { data: json as T };
}

/** Unauthenticated GET — for the handful of routes outside the
 * `:authenticated` pipeline that aren't a plain POST (see router.ex's first
 * scope: healthz, register, login, and this one, verify-email). */
async function get<T>(path: string): Promise<ApiResult<T>> {
  try {
    const resp = await fetch(`${API_BASE_URL}/api${path}`, { headers: languageHeader() });
    const json = await resp.json();
    if (!resp.ok) {
      const err = json as ApiError;
      return { error: err.error ?? t('Bir hata oluştu') };
    }
    return { data: json as T };
  } catch {
    return { error: AUTH_REQUEST_ERRORS.network };
  }
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const resp = await fetch(`${API_BASE_URL}/api${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        ...languageHeader(),
        Authorization: `Bearer ${getStoredToken() ?? ''}`,
      },
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
      return { error: t('Oturum süresi doldu, lütfen tekrar giriş yapın.') };
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
      return { error: err.error ?? t('Bir hata oluştu') };
    }
    return { data: json as T };
  } catch {
    return { error: AUTH_REQUEST_ERRORS.network };
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

function authedDelete<T>(path: string, body?: Record<string, string>): Promise<ApiResult<T>> {
  return authedFetch<T>(path, {
    method: 'DELETE',
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

function authedPatch<T>(path: string, body: Record<string, string>): Promise<ApiResult<T>> {
  return authedFetch<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** No longer logs the caller in — the account starts unverified, and
 * `loginUser` below refuses to issue a token until `GET
 * /api/verify-email/:token` (see VerifyEmailPage) flips it. */
export function registerUser(
  username: string,
  email: string,
  password: string
): Promise<ApiResult<RegisterResponse>> {
  return post<RegisterResponse>('/users/register', { username, email, password });
}

/** On an unverified account, `result.error` is the literal string
 * `"email_not_verified"` (see BackendWeb.UserController.login/2) rather than
 * a human-readable message — callers must check for that exact value
 * themselves and show their own copy instead of displaying it raw (see
 * PROJECT_ARCHITECTURE.md §7 item 12 for the same raw-reason-string pitfall
 * elsewhere). */
export async function loginUser(
  email: string,
  password: string
): Promise<ApiResult<AuthResponse | TwoFactorChallenge>> {
  const result = await post<AuthResponse | TwoFactorChallenge>('/users/login', { email, password });
  if (result.data && 'token' in result.data) storeToken(result.data.token);
  return result;
}

/** The second step of a two-factor sign-in: the challenge `loginUser`
 * returned and a code from the authenticator app (or a recovery code). */
export async function loginWithTwoFactor(challenge: string, code: string): Promise<ApiResult<AuthResponse>> {
  const result = await post<AuthResponse>('/users/login/2fa', { challenge, code });
  if (result.data) storeToken(result.data.token);
  return result;
}

export function fetchTwoFactorStatus(): Promise<ApiResult<TwoFactorStatus>> {
  return authedGet<TwoFactorStatus>('/account/2fa');
}

/** Starts setting up two-factor sign-in; changes nothing until `enableTwoFactor`. */
export function startTwoFactorSetup(currentPassword: string): Promise<ApiResult<TwoFactorSetup>> {
  return authedPost<TwoFactorSetup>('/account/2fa/setup', { current_password: currentPassword });
}

/** Turns two-factor on; resolves to the recovery codes, shown once. */
export function enableTwoFactor(
  setupToken: string,
  code: string
): Promise<ApiResult<{ recovery_codes: string[] }>> {
  return authedPost<{ recovery_codes: string[] }>('/account/2fa/enable', { setup_token: setupToken, code });
}

export function disableTwoFactor(currentPassword: string, code: string): Promise<ApiResult<void>> {
  return authedPost<void>('/account/2fa/disable', { current_password: currentPassword, code });
}

/** GET /api/push — whether the server can send Web Push (VAPID keys set),
 * and the public key to subscribe with. */
export function fetchPushConfig(): Promise<ApiResult<{ enabled: boolean; public_key: string | null }>> {
  return authedGet<{ enabled: boolean; public_key: string | null }>('/push');
}

/** POST /api/push/subscriptions — this browser's `PushSubscription.toJSON()`,
 * tied server-side to the current session (see Backend.Push). */
export function savePushSubscription(subscription: PushSubscriptionJSON): Promise<ApiResult<void>> {
  return authedFetch<void>('/push/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  });
}

/** DELETE /api/push/subscriptions — stop pushing to this browser. */
export function deletePushSubscription(endpoint: string): Promise<ApiResult<void>> {
  return authedDelete<void>('/push/subscriptions', { endpoint });
}

/** POST /api/account/2fa/recovery-codes — ten new recovery codes (shown
 * once); the old ones stop working. */
export function regenerateRecoveryCodes(
  currentPassword: string,
  code: string
): Promise<ApiResult<{ recovery_codes: string[] }>> {
  return authedPost<{ recovery_codes: string[] }>('/account/2fa/recovery-codes', {
    current_password: currentPassword,
    code,
  });
}

/** GET /api/verify-email/:token — flips the account's email_verified flag.
 * `result.error` is `"invalid_token"` or `"token_expired"` on failure (see
 * BackendWeb.VerificationController.verify/2), also meant to be matched on
 * rather than shown raw. */
export function verifyEmail(token: string): Promise<ApiResult<MessageResponse>> {
  return get<MessageResponse>(`/verify-email/${encodeURIComponent(token)}`);
}

/** POST /api/resend-verification — always resolves to the same generic
 * success message regardless of whether the email is registered/already
 * verified (see BackendWeb.VerificationController.resend/2's anti-enumeration
 * note), so there's no special-casing needed here beyond the usual
 * network-error path. */
export function resendVerification(email: string): Promise<ApiResult<MessageResponse>> {
  return post<MessageResponse>('/resend-verification', { email });
}

/** POST /api/password-reset — always resolves to the same generic message
 * whether or not the address is registered (anti-enumeration, same as
 * resendVerification). */
export function requestPasswordReset(email: string): Promise<ApiResult<MessageResponse>> {
  return post<MessageResponse>('/password-reset', { email });
}

/** POST /api/password-reset/confirm — `result.error` is the literal
 * `"invalid_token"` or `"token_expired"` for a bad link (see
 * BackendWeb.PasswordResetController), meant to be matched on, not shown. */
export function confirmPasswordReset(token: string, password: string): Promise<ApiResult<MessageResponse>> {
  return post<MessageResponse>('/password-reset/confirm', { token, password });
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

/** Owner only. Promotes a member to moderator or demotes them back. */
export function setMemberRole(
  serverId: string,
  userId: string,
  role: 'moderator' | 'member'
): Promise<ApiResult<{ user_id: string; role: MemberRole }>> {
  return authedPatch(`/servers/${serverId}/members/${userId}`, { role });
}

/** Reports a message. Channel reports go to the server's owner and
 * moderators; DM reports to the Zircle team (see Backend.Reports). */
export function reportMessage(
  target: ReportTarget,
  reason: ReportReason,
  details: string
): Promise<ApiResult<{ id: string }>> {
  const body: Record<string, string> = {
    [target.kind === 'dm' ? 'dm_message_id' : 'message_id']: target.id,
    reason,
  };
  if (details) body.details = details;
  return authedPost('/reports', body);
}

/** Owner or moderator. The server's open reports, newest first. */
export function fetchServerReports(serverId: string): Promise<ApiResult<ServerReport[]>> {
  return authedGet<ServerReport[]>(`/servers/${serverId}/reports`);
}

/** Owner or moderator. Closes a report as resolved or dismissed. */
export function reviewReport(
  serverId: string,
  reportId: string,
  status: 'resolved' | 'dismissed'
): Promise<ApiResult<{ id: string; status: string }>> {
  return authedPatch(`/servers/${serverId}/reports/${reportId}`, { status });
}

/** Whether the signed-in user is a platform admin (reviews DM reports). */
export function fetchAdminStatus(): Promise<ApiResult<{ is_admin: boolean }>> {
  return authedGet<{ is_admin: boolean }>('/admin');
}

/** Platform admins. The open DM reports, newest first. */
export function fetchDmReports(): Promise<ApiResult<DmReport[]>> {
  return authedGet<DmReport[]>('/admin/dm-reports');
}

/** Platform admins. Closes a DM report as resolved or dismissed. */
export function reviewDmReport(
  reportId: string,
  status: 'resolved' | 'dismissed'
): Promise<ApiResult<{ id: string; status: string }>> {
  return authedPatch(`/admin/dm-reports/${reportId}`, { status });
}

export interface ServerBan {
  user_id: string;
  username: string | null;
  reason: string | null;
  banned_at: string;
}

/** Owner or moderator (a moderator only for regular members). Removes the user from the server if they're a member and
 * keeps them from rejoining through any invite until unbanned. */
export function banMember(serverId: string, userId: string, reason: string): Promise<ApiResult<unknown>> {
  return authedFetch<unknown>(`/servers/${serverId}/bans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reason ? { user_id: userId, reason } : { user_id: userId }),
  });
}

export function fetchServerBans(serverId: string): Promise<ApiResult<ServerBan[]>> {
  return authedGet<ServerBan[]>(`/servers/${serverId}/bans`);
}

export function unbanMember(serverId: string, userId: string): Promise<ApiResult<void>> {
  return authedFetch<void>(`/servers/${serverId}/bans/${userId}`, { method: 'DELETE' });
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
/** Sets the profile picture to an uploaded image's URL, or null to remove it. */
export function updateAvatar(avatarUrl: string | null): Promise<ApiResult<User>> {
  return authedFetch<User>('/account/avatar', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatar_url: avatarUrl }),
  });
}

/** Owner only. Sets the server icon to an uploaded image's URL, or null to remove it. */
export function updateServerIcon(serverId: string, iconUrl: string | null): Promise<ApiResult<Server>> {
  return authedFetch<Server>(`/servers/${serverId}/icon`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ icon_url: iconUrl }),
  });
}

/** `private: true` for DM attachments: the server stores them privately and
 * returns a `private:…` reference instead of a URL; readers get expiring
 * links to it (see BackendWeb.PrivateFileURL). */
export function uploadFile(file: File, options: { private?: boolean } = {}): Promise<ApiResult<UploadResult>> {
  const formData = new FormData();
  formData.append('file', file);
  if (options.private) formData.append('private', 'true');
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

/**
 * Proxied Metered.ca TURN credentials (see BackendWeb.VoiceController) —
 * the Metered API key stays server-side. `ice_servers` may be `[]` if no
 * TURN provider is configured/reachable; see useVoiceChannel.ts's
 * fetchBackendTurnServers, which treats that the same as a network
 * failure (add nothing, keep the existing static STUN list).
 */
export function fetchTurnCredentials(): Promise<ApiResult<TurnCredentialsResponse>> {
  return authedGet<TurnCredentialsResponse>('/voice/turn-credentials');
}

/** Changes the current user's username — requires re-entering the current
 * password (see BackendWeb.AccountController.update_username/2). */
export function updateUsername(username: string, currentPassword: string): Promise<ApiResult<User>> {
  return authedPatch<User>('/account/username', { username, current_password: currentPassword });
}

export interface EmailChangeResponse {
  message: string;
  pending_email: string;
}

/** Starts changing the current user's email — same current-password
 * requirement as updateUsername. Doesn't change it yet: the backend mails a
 * confirmation link to the new address (and a notice to the current one);
 * the change applies once that link is followed (ConfirmEmailChangePage). */
export function updateEmail(
  email: string,
  currentPassword: string
): Promise<ApiResult<EmailChangeResponse>> {
  return authedPatch<EmailChangeResponse>('/account/email', { email, current_password: currentPassword });
}

/** POST /api/account/email/confirm — applies a pending email change.
 * `result.error` is the literal `"invalid_token"` or `"token_expired"` for a
 * bad link (see BackendWeb.EmailChangeController), meant to be matched on. */
export function confirmEmailChange(token: string): Promise<ApiResult<{ message: string; email: string }>> {
  return post<{ message: string; email: string }>('/account/email/confirm', { token });
}

/** Changes the current user's password. On success, every previously
 * issued token — including the one this very request used — stops
 * authenticating (see BackendWeb.AccountController.update_password/3), so
 * the caller is expected to force a fresh login afterwards rather than
 * keep using the current session. */
export function updatePassword(
  currentPassword: string,
  newPassword: string
): Promise<ApiResult<User>> {
  return authedPatch<User>('/account/password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

/** "everyone" (default) or "nobody" — checked by the backend before a
 * friend request is even created (see BackendWeb.AccountController). */
export function updateFriendRequestPrivacy(
  privacy: FriendRequestPrivacy
): Promise<ApiResult<{ friend_request_privacy: FriendRequestPrivacy }>> {
  return authedPatch('/account/friend-request-privacy', { friend_request_privacy: privacy });
}

/** Lists every user the current account has blocked (never who has blocked them). */
export function fetchBlockedUsers(): Promise<ApiResult<BlockedUser[]>> {
  return authedGet<BlockedUser[]>('/account/blocked-users');
}

/** Blocks a user by id — they can no longer send a friend request, open a
 * new DM, or send a message in an existing DM room; existing message
 * history is untouched (see Backend.Friends.block_user/2). */
export function blockUser(userId: string): Promise<ApiResult<void>> {
  return authedPost<void>(`/users/${userId}/block`, {});
}

/** Permanently and irreversibly deletes/anonymizes the current account
 * (see Backend.Accounts.delete_account/2 for exactly what happens to
 * each piece of related data) — requires re-entering the current
 * password, same as updateUsername/updateEmail/updatePassword above. */
export function deleteAccount(currentPassword: string): Promise<ApiResult<void>> {
  return authedDelete<void>('/account', { current_password: currentPassword });
}

export function unblockUser(userId: string): Promise<ApiResult<void>> {
  return authedDelete<void>(`/users/${userId}/block`);
}

/** POST /api/users/renew-token — swaps the current, still-valid session
 * token for a fresh 7-day one and stores it (see App.tsx's renewal effect).
 * A revoked or expired token gets a 401 here, which signs the user out the
 * same way any other 401 does. */
export async function renewSessionToken(): Promise<ApiResult<{ token: string }>> {
  const result = await authedFetch<{ token: string }>('/users/renew-token', { method: 'POST' });
  if (result.data?.token) storeToken(result.data.token);
  return result;
}

/** This account's signed-in devices, most recently active first. */
export function fetchSessions(): Promise<ApiResult<ActiveSession[]>> {
  return authedGet<ActiveSession[]>('/account/sessions');
}

/** Signs one of this account's sessions out; its token stops working at once. */
export function revokeSession(sessionId: string): Promise<ApiResult<void>> {
  return authedFetch<void>(`/account/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

/** Ends this session on the server (POST /api/users/logout) — called just
 * before the app forgets its token, so a copied token stops working too. */
export function logoutCurrentSession(): Promise<ApiResult<void>> {
  return authedFetch<void>('/users/logout', { method: 'POST' });
}
