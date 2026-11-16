export interface User {
  id: string;
  username: string;
  email: string;
  /** Optional — only present on the login/register response, not every
   * place a `User` gets constructed (e.g. tests). Absent means "everyone"
   * (the backend's own default for a freshly registered user). */
  friend_request_privacy?: FriendRequestPrivacy;
  /** Profile picture URL (see Backend.Uploads), or null for the initials. */
  avatar_url?: string | null;
}

export interface AuthResponse extends User {
  token: string;
}

/** What `POST /api/users/login` returns instead of a session when the
 * account has two-factor sign-in on: finish with `loginWithTwoFactor`. */
export interface TwoFactorChallenge {
  two_factor: true;
  challenge: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  recovery_codes_left: number;
}

/** `POST /api/account/2fa/setup` — the secret to add to an authenticator app. */
export interface TwoFactorSetup {
  /** Base32, for typing in by hand. */
  secret: string;
  otpauth_uri: string;
  /** An SVG QR code of `otpauth_uri`, as a data URI. */
  qr_data_uri: string;
  setup_token: string;
}

/** `POST /api/users/register`'ın artık döndürdüğü şey — bir token/User değil,
 * çünkü hesap e-posta doğrulanana kadar giriş yapılamıyor (bkz.
 * BackendWeb.UserController.register/2). */
export interface RegisterResponse {
  message: string;
  email_verification_required: boolean;
}

/** `GET /api/verify-email/:token` (başarı) ve `POST /api/resend-verification`
 * ortak dönüş şekli — ikisi de sadece kullanıcıya gösterilecek bir mesaj taşır. */
export interface MessageResponse {
  message: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  user_ids: string[];
}

/** A short preview of the message a reply answers (see BackendWeb.MessageJSON.reply_preview/1). */
export interface ReplyPreview {
  id: string;
  user_id: string | null;
  username: string | null;
  /** First 200 characters; null if the original was deleted or had no text. */
  content: string | null;
  has_file: boolean;
  is_deleted: boolean;
}

export interface ChatMessage {
  id: string;
  content: string;
  file_url: string | null;
  file_type: string | null;
  /** The attachment's original name and size in bytes; absent/null on
   * text-only messages and on files sent before these were kept. */
  file_name?: string | null;
  file_size?: number | null;
  user_id: string;
  username: string | null;
  /** Profile picture URL (see Backend.Uploads), or null for the initials. */
  avatar_url?: string | null;
  inserted_at: string;
  is_edited: boolean;
  reactions: Reaction[];
  /** The message this one replies to, if any. */
  reply_to?: ReplyPreview | null;
  /** DB-assigned monotonic send order — currently only populated on DM
   * messages (see BackendWeb.DmChannel/DmController), used to tell the
   * server the newest message a user has actually read (see
   * useDMStore.ts's markRoomRead). Optional because server-channel
   * messages don't carry it (yet). */
  seq?: number;
  /** Soft-delete marker (see Backend.Chat.Message/DmMessage's
   * delete_changeset/1) — true means content/file_url/file_type have
   * already been wiped to null server-side; MessageItem renders a
   * placeholder instead of trusting those fields to still hold anything. */
  is_deleted: boolean;
}

/** A page of message history from `GET .../messages`, oldest → newest —
 * `has_more` tells the caller whether another older page is worth fetching. */
export interface MessagesPage {
  messages: ChatMessage[];
  has_more: boolean;
}

/** Optional filters for `searchChannelMessages`/`searchDmMessages` — all
 * fields are optional and combine as AND. */
export interface SearchFilters {
  query?: string;
  author_id?: string;
  has_file?: boolean;
}

/** Search results from `GET .../search`, most recent match first — capped
 * at a fixed page size server-side, not cursor-paginated. */
export interface SearchResultsPage {
  messages: ChatMessage[];
}

/** Broadcast on both "chat:<id>" and "dm:<id>" topics whenever a reaction is
 * added/removed — `reactions` is the message's full, already-grouped list
 * (not a delta), so the store just replaces it. */
export interface ReactionToggledPayload {
  message_id: string;
  reactions: Reaction[];
}

/** Why a fire-and-forget channel push (see services/socket.ts) didn't
 * succeed: either the server replied `{:error, ...}` — `reason` is its
 * reason string ("rate_limited", "blocked", "not authorized", ...), absent
 * for a changeset `errors` reply — or no reply arrived before Phoenix's push
 * timeout. A timed-out push isn't necessarily lost: one made while the
 * socket was down stays in the channel's push buffer and is still sent on
 * rejoin, even after its timeout has fired. */
export type PushFailure = { kind: 'error'; reason?: string } | { kind: 'timeout' };

/** A signed-in device, from `GET /api/account/sessions` (see
 * Backend.Accounts.Session). `current` is the session this app is using. */
export interface ActiveSession {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

/** `POST /api/upload`'s reply — also exactly what a message push carries as
 * its attachment (see services/socket.ts's shout/sendDmMessage). */
export interface UploadResult {
  file_url: string;
  file_type: string;
  /** Optional only for older fixtures; the server always sends both. */
  file_name?: string;
  file_size?: number;
}

export interface NewMessageNotification extends ChatMessage {
  channel_id: string;
  channel_name: string;
  server_id: string;
}

export interface PresenceUser {
  user_id: string;
  username: string | null;
  /** Profile picture (see BackendWeb.PresenceMeta), or null without one. */
  avatar_url?: string | null;
  online_at: number;
  muted?: boolean;
  deafened?: boolean;
  /** Voice through the SFU only (see services/sfu.ts): the tracks this
   * participant publishes ("audio", "screen"). */
  sfu_tracks?: string[] | null;
  /** ...and the SFU session they publish them in; a new one after their
   * connection dropped and came back (see services/sfu.ts). */
  sfu_session?: string | null;
}

export interface TypingNotification {
  user_id: string;
  username: string | null;
  is_typing: boolean;
}

export type ChannelType = 'text' | 'voice' | 'category';

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  /** The category channel (`type: 'category'`) this one is grouped under,
   * or `null` if it's uncategorized (or is itself a category — categories
   * are one level deep, never nested). */
  parent_id: string | null;
  /** Sort order among siblings (same `parent_id`) — ascending. */
  position: number;
  /** Who's currently connected to this voice room — present (possibly `[]`)
   * only for `type: 'voice'` channels, absent for text/category (see
   * Backend.Chat.voice_occupants/1 and the channel-list endpoint's
   * `channel_json/1`). Kept live via "voice_presence_updated" broadcasts
   * (see VoicePresenceUpdatedNotification) rather than re-fetched. */
  voice_occupants?: { user_id: string; username: string; avatar_url?: string | null }[];
}

export type MemberRole = 'owner' | 'moderator' | 'member';

export interface Server {
  id: string;
  name: string;
  owner_id: string;
  /** The current user's own role here (see Backend.Servers.list_servers_for_user/1).
   * Missing only on a server object built before the user's role was known. */
  my_role?: MemberRole;
  /** Server icon URL (see Backend.Uploads), or null for the initials. */
  icon_url?: string | null;
}

export type UserStatus = 'online' | 'offline';

export interface ServerMember {
  user_id: string;
  username: string | null;
  /** Profile picture URL (see Backend.Uploads), or null for the initials. */
  avatar_url?: string | null;
  role: MemberRole;
  status: UserStatus;
}

export interface MemberStatusChangedNotification {
  user_id: string;
  status: UserStatus;
}

export interface ChannelDeletedNotification {
  channel_id: string;
  server_id: string;
}

export interface ChannelCreatedNotification extends Channel {
  server_id: string;
}

/** Broadcast once to the shared "server:<id>" topic whenever a channel
 * moves into/out of a category or its siblings get reordered (see
 * Backend.Servers.update_channel_positions/2) — carries the server's full,
 * freshly-ordered channel list rather than a diff. */
export interface ChannelPositionsUpdatedNotification {
  server_id: string;
  channels: Channel[];
}

export interface ServerUpdatedNotification {
  server_id: string;
  name: string;
  icon_url?: string | null;
}

export interface ServerDeletedNotification {
  server_id: string;
}

/** "member_role_updated" — sent to the server topic and to the member's own
 * user topic when the owner promotes or demotes them (see
 * Backend.Servers.set_member_role/3). */
export interface MemberRoleUpdatedNotification {
  server_id: string;
  user_id: string;
  role: MemberRole;
}

export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'other';

/** What a report is about: a server channel message or a DM message. */
export interface ReportTarget {
  kind: 'message' | 'dm';
  id: string;
}

/** An open report as the server's owner/moderators see it (see BackendWeb.ReportController). */
export interface ServerReport {
  id: string;
  reason: ReportReason;
  details: string | null;
  /** A copy of the message taken when it was reported. */
  content: string | null;
  file_url: string | null;
  message_id: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
  reporter: { id: string | null; username: string | null };
  reported_user: { id: string | null; username: string | null };
}

/** "report_created" on the user topic of a server's owner and moderators. */
export interface ReportCreatedNotification {
  server_id: string;
  report_id: string;
}

export interface MemberKickedNotification {
  server_id: string;
  user_id: string;
}

/** Broadcast once to the shared "server:<id>" topic (see BackendWeb.ServerChannel)
 * whenever a member leaves or is kicked — same shape as MemberKickedNotification,
 * which stays a separate, personal-channel-only event specifically for the
 * affected user (see Backend.Servers.kick_member/2). */
export interface MemberLeftNotification {
  server_id: string;
  user_id: string;
}

/** Broadcast to the shared "server:<id>" topic whenever a voice room's
 * occupants change — someone joins or leaves `channel_id` (see
 * BackendWeb.VoiceChannel's join/3 and terminate/2). Carries the room's
 * full, freshly-computed occupant list rather than a diff — same
 * "server echoes the full current state" convention as
 * ChannelPositionsUpdatedNotification. */
export interface VoicePresenceUpdatedNotification {
  channel_id: string;
  users: { user_id: string; username: string }[];
}

export interface Invite {
  id: string;
  code: string;
  server_id: string;
  expires_at: string | null;
  max_uses: number | null;
  uses_count: number;
}

/** Explicit "I just stopped screen sharing" signal (BackendWeb.VoiceChannel's
 * "screen_share_stopped") — independent of the WebRTC renegotiation that
 * also happens alongside it, so a peer's screenShares tile clears reliably
 * even if that peer's remote video track's 'ended' event never fires (see
 * useVoiceChannel.ts's stopScreenShare/onScreenShareStopped). */
export interface ScreenShareStoppedNotification {
  user_id: string;
}

export interface VoiceSignalPayload {
  from: string;
  to: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

/** `GET /api/voice/turn-credentials` — see BackendWeb.VoiceController.
 * `ice_servers` is empty (not an error) when no TURN provider is
 * configured/reachable server-side. */
export interface TurnCredentialsResponse {
  ice_servers: RTCIceServer[];
}

export interface ApiError {
  error?: string;
  errors?: Record<string, string[]>;
}

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';
export type FriendshipDirection = 'incoming' | 'outgoing';
export type FriendRequestPrivacy = 'everyone' | 'nobody';

/** One entry in the "who have I blocked" list (see
 * Backend.Friends.list_blocked_users/1) — never who has blocked *me*. */
export interface BlockedUser {
  user_id: string;
  username: string | null;
}

/** A friendship/request row, already shaped from the viewing user's point of
 * view by the backend (see Backend.Friends.to_view/2) — `user_id`/`username`/
 * `user_status` describe the OTHER person, never the viewer themselves. */
export interface Friendship {
  id: string;
  status: FriendshipStatus;
  direction: FriendshipDirection;
  user_id: string;
  username: string | null;
  /** Profile picture URL (see Backend.Uploads), or null for the initials. */
  avatar_url?: string | null;
  user_status: UserStatus;
}

export interface FriendRemovedNotification {
  id: string;
}

/** A DM room, already shaped from the viewing user's point of view by the
 * backend (see Backend.DirectMessages.to_view/2) — `user_id`/`username`/
 * `user_status` describe the OTHER participant, never the viewer. */
export interface DmRoom {
  id: string;
  user_id: string;
  username: string | null;
  /** Profile picture URL (see Backend.Uploads), or null for the initials. */
  avatar_url?: string | null;
  user_status: UserStatus;
  /** How many of this room's messages the viewer hasn't read yet — the
   * viewer's own messages never count (see Backend.DirectMessages.unread_count/2). */
  unread_count: number;
}

export interface NewDmMessageNotification extends ChatMessage {
  dm_room_id: string;
}

/** OpenGraph (or plain <title>/<meta name="description">) metadata for a
 * chat link-preview card — see Backend.LinkPreview. Any field but `url` may
 * be null if the page didn't have it. */
export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
}
