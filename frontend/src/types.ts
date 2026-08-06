export interface User {
  id: string;
  username: string;
  email: string;
  /** Optional — only present on the login/register response, not every
   * place a `User` gets constructed (e.g. tests). Absent means "everyone"
   * (the backend's own default for a freshly registered user). */
  friend_request_privacy?: FriendRequestPrivacy;
}

export interface AuthResponse extends User {
  token: string;
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

export interface ChatMessage {
  id: string;
  content: string;
  file_url: string | null;
  file_type: string | null;
  user_id: string;
  username: string | null;
  inserted_at: string;
  is_edited: boolean;
  reactions: Reaction[];
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

export interface UploadResult {
  file_url: string;
  file_type: string;
}

export interface NewMessageNotification extends ChatMessage {
  channel_id: string;
  channel_name: string;
  server_id: string;
}

export interface PresenceUser {
  user_id: string;
  username: string | null;
  online_at: number;
  muted?: boolean;
  deafened?: boolean;
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
  voice_occupants?: { user_id: string; username: string }[];
}

export interface Server {
  id: string;
  name: string;
  owner_id: string;
}

export type UserStatus = 'online' | 'offline';

export interface ServerMember {
  user_id: string;
  username: string | null;
  role: 'owner' | 'member';
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
}

export interface ServerDeletedNotification {
  server_id: string;
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
