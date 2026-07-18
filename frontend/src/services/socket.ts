import { Socket, Channel, Presence } from 'phoenix';
import type {
  ChatMessage,
  PresenceUser,
  VoiceSignalPayload,
  NewMessageNotification,
  TypingNotification,
  ChannelDeletedNotification,
  ChannelCreatedNotification,
  ChannelPositionsUpdatedNotification,
  ServerUpdatedNotification,
  ServerDeletedNotification,
  MemberKickedNotification,
  MemberLeftNotification,
  MemberStatusChangedNotification,
  Friendship,
  FriendRemovedNotification,
  NewDmMessageNotification,
  ReactionToggledPayload,
} from '../types';
import { getStoredToken } from './tokenStorage';
import { resolveSocketUrl } from '../config';
import { useConnectionStore } from '../stores/useConnectionStore';
import { forceLogout } from './session';

let socket: Socket | null = null;
let textChannel: Channel | null = null;
let voiceChannel: Channel | null = null;
let userChannel: Channel | null = null;
let dmChannel: Channel | null = null;
let serverChannel: Channel | null = null;

// How many consecutive connect attempts are allowed to fail, without the
// socket ever successfully opening even once, before giving up entirely —
// see the onError handler below.
const MAX_FAILED_CONNECTS_BEFORE_GIVING_UP = 3;
let consecutiveFailedConnects = 0;

function getSocket(): Socket {
  if (!socket) {
    // Same-origin (Vite dev proxy / ngrok tunnel) unless VITE_API_URL points
    // at a separately-deployed backend — see src/config.ts.
    // A function (not a plain object) so a reconnect always re-reads the
    // latest token from localStorage instead of a value captured at startup.
    socket = new Socket(resolveSocketUrl(), { params: () => ({ token: getStoredToken() }) });
    socket.onOpen(() => {
      consecutiveFailedConnects = 0;
      useConnectionStore.getState().setConnected(true);
    });
    socket.onClose(() => useConnectionStore.getState().setConnected(false));
    // Phoenix calls this with (error, transportBefore, establishedConnections
    // as of just before this failure) on every failed connect attempt,
    // including each automatic retry. A rejected connect (see
    // BackendWeb.UserSocket.connect/3 returning :error for an invalid/
    // revoked token) surfaces here exactly like a network failure would —
    // browsers don't expose the HTTP status of a failed WebSocket handshake
    // — so there's no way to tell the two apart from a single event.
    // establishedConnections > 0 means this socket instance has connected
    // successfully before, so a failure now is almost certainly a
    // transient blip (see useVoiceChannel's own ICE-restart handling for the
    // analogous case on the WebRTC side) — leave Phoenix's own reconnect
    // timer to keep trying. establishedConnections === 0 across several
    // consecutive attempts, on the other hand, means every single try has
    // failed before ever opening once, which is what a bad/revoked token
    // looks like — at that point, retrying forever would just spam the
    // server with a token it's already rejecting, so stop and end the
    // session instead of leaving the user stuck looking logged-in forever.
    socket.onError((_error, _transport, establishedConnections) => {
      useConnectionStore.getState().setConnected(false);
      if (establishedConnections > 0) {
        consecutiveFailedConnects = 0;
        return;
      }

      consecutiveFailedConnects += 1;
      if (consecutiveFailedConnects < MAX_FAILED_CONNECTS_BEFORE_GIVING_UP) return;

      disconnectSocket();
      forceLogout();
    });
    socket.connect();
  }
  return socket;
}

export interface ChannelCallbacks {
  onShout: (msg: ChatMessage) => void;
  onJoined: (resp: { messages: ChatMessage[] }) => void;
  onError: (reason: string) => void;
  onPresenceChange: (users: PresenceUser[]) => void;
  onTyping: (payload: TypingNotification) => void;
  onReactionToggled: (payload: ReactionToggledPayload) => void;
  onMessageUpdated: (msg: ChatMessage) => void;
}

/** Joins the given text channel's socket topic (by channel id) and returns a cleanup function. */
export function joinChatChannel(channelId: string, callbacks: ChannelCallbacks): () => void {
  const s = getSocket();
  textChannel = s.channel(`chat:${channelId}`, {});

  const presence = new Presence(textChannel);
  presence.onSync(() => {
    const users = presence.list<PresenceUser>((user_id, { metas: [meta] }) => ({
      user_id,
      username: meta.username,
      online_at: meta.online_at,
    }));
    callbacks.onPresenceChange(users);
  });

  textChannel.on('shout', (msg: ChatMessage) => callbacks.onShout(msg));
  textChannel.on('user_typing', (payload: TypingNotification) => callbacks.onTyping(payload));
  textChannel.on('reaction_toggled', (payload: ReactionToggledPayload) =>
    callbacks.onReactionToggled(payload)
  );
  textChannel.on('message_updated', (msg: ChatMessage) => callbacks.onMessageUpdated(msg));

  textChannel
    .join()
    .receive('ok', (resp: { messages: ChatMessage[] }) => callbacks.onJoined(resp))
    .receive('error', (resp: { reason?: string }) =>
      callbacks.onError(resp.reason ?? 'Failed to join channel')
    );

  return () => {
    textChannel?.leave();
    textChannel = null;
  };
}

/** Sends a "shout" event with the message content (and optional attachment); the server attributes it to the authenticated user. */
export function shout(content: string, fileUrl?: string, fileType?: string): void {
  textChannel?.push('shout', { content, file_url: fileUrl, file_type: fileType });
}

/** Tells the rest of the channel whether the current user is typing. */
export function sendTyping(isTyping: boolean): void {
  textChannel?.push('typing', { is_typing: isTyping });
}

/** Adds/removes the current user's `emoji` reaction on a message; the server toggles and broadcasts the result. */
export function toggleReaction(messageId: string, emoji: string): void {
  textChannel?.push('toggle_reaction', { message_id: messageId, emoji });
}

/** Edits an existing message's content; the server validates authorship and broadcasts "message_updated". */
export function editMessage(messageId: string, content: string): void {
  textChannel?.push('update_message', { message_id: messageId, content });
}

/**
 * Joins a DM room's socket topic (by room id) and returns a cleanup
 * function — same shape as `joinChatChannel` (join response, "shout",
 * "user_typing", presence), since `BackendWeb.DmChannel` mirrors
 * `BackendWeb.ChatChannel` almost exactly, just scoped to two participants
 * instead of a server's members.
 */
export function joinDmChannel(roomId: string, callbacks: ChannelCallbacks): () => void {
  const s = getSocket();
  dmChannel = s.channel(`dm:${roomId}`, {});

  const presence = new Presence(dmChannel);
  presence.onSync(() => {
    const users = presence.list<PresenceUser>((user_id, { metas: [meta] }) => ({
      user_id,
      username: meta.username,
      online_at: meta.online_at,
    }));
    callbacks.onPresenceChange(users);
  });

  dmChannel.on('shout', (msg: ChatMessage) => callbacks.onShout(msg));
  dmChannel.on('user_typing', (payload: TypingNotification) => callbacks.onTyping(payload));
  dmChannel.on('reaction_toggled', (payload: ReactionToggledPayload) =>
    callbacks.onReactionToggled(payload)
  );
  dmChannel.on('dm_message_updated', (msg: ChatMessage) => callbacks.onMessageUpdated(msg));

  dmChannel
    .join()
    .receive('ok', (resp: { messages: ChatMessage[] }) => callbacks.onJoined(resp))
    .receive('error', (resp: { reason?: string }) =>
      callbacks.onError(resp.reason ?? 'Failed to join DM room')
    );

  return () => {
    dmChannel?.leave();
    dmChannel = null;
  };
}

/** Sends a "shout" event with the message content (and optional attachment) to the active DM room. */
export function sendDmMessage(content: string, fileUrl?: string, fileType?: string): void {
  dmChannel?.push('shout', { content, file_url: fileUrl, file_type: fileType });
}

/** Tells the other DM participant whether the current user is typing. */
export function sendDmTyping(isTyping: boolean): void {
  dmChannel?.push('typing', { is_typing: isTyping });
}

/** Adds/removes the current user's `emoji` reaction on a DM message; the server toggles and broadcasts the result. */
export function toggleDmReaction(messageId: string, emoji: string): void {
  dmChannel?.push('toggle_reaction', { message_id: messageId, emoji });
}

/** Edits an existing DM message's content; the server validates authorship and broadcasts "dm_message_updated". */
export function editDmMessage(messageId: string, content: string): void {
  dmChannel?.push('update_message', { message_id: messageId, content });
}

export interface VoiceChannelCallbacks {
  onPresenceChange: (users: PresenceUser[]) => void;
  onOffer: (payload: VoiceSignalPayload) => void;
  onAnswer: (payload: VoiceSignalPayload) => void;
  onIceCandidate: (payload: VoiceSignalPayload) => void;
}

export interface VoiceChannelHandle {
  /** User ids already present in the room at join time. */
  existingPeerIds: string[];
  leave: () => void;
}

/**
 * Joins a voice room's WebRTC signaling topic. Runs independently of the
 * text channel — a user can browse text channels while staying connected
 * to voice, so this keeps its own channel reference.
 */
export function joinVoiceChannel(
  roomId: string,
  callbacks: VoiceChannelCallbacks
): Promise<VoiceChannelHandle> {
  const s = getSocket();
  const room = s.channel(`voice:${roomId}`, {});
  voiceChannel = room;

  const presence = new Presence(room);
  presence.onSync(() => {
    const users = presence.list<PresenceUser>((user_id, { metas: [meta] }) => ({
      user_id,
      username: meta.username,
      online_at: meta.online_at,
      muted: meta.muted,
      deafened: meta.deafened,
    }));
    callbacks.onPresenceChange(users);
  });

  room.on('video_offer', (payload: VoiceSignalPayload) => callbacks.onOffer(payload));
  room.on('video_answer', (payload: VoiceSignalPayload) => callbacks.onAnswer(payload));
  room.on('ice_candidate', (payload: VoiceSignalPayload) => callbacks.onIceCandidate(payload));

  return new Promise((resolve, reject) => {
    room
      .join()
      .receive('ok', (resp: { peers: string[] }) => {
        resolve({
          existingPeerIds: resp.peers,
          leave: () => {
            room.leave();
            if (voiceChannel === room) voiceChannel = null;
          },
        });
      })
      .receive('error', (resp: { reason?: string }) => {
        reject(new Error(resp.reason ?? 'Failed to join voice channel'));
      });
  });
}

export function sendVoiceOffer(payload: VoiceSignalPayload): void {
  voiceChannel?.push('video_offer', payload);
}

export function sendVoiceAnswer(payload: VoiceSignalPayload): void {
  voiceChannel?.push('video_answer', payload);
}

export function sendIceCandidate(payload: VoiceSignalPayload): void {
  voiceChannel?.push('ice_candidate', payload);
}

/** Broadcasts the current user's mute/deafen state to the rest of the voice room. */
export function sendVoiceStatus(muted: boolean, deafened: boolean): void {
  voiceChannel?.push('update_status', { muted, deafened });
}

/**
 * Diagnostic-only, fire-and-forget: reports which ICE candidate type a
 * peer connection ended up using (or none, if it never got one) — see
 * useVoiceChannel.ts's logIceOutcome for what calls this and why. Never
 * carries a candidate's own address/ip/port, only its type.
 */
export function sendIceDiagnostics(
  candidateType: RTCIceCandidateType | null,
  connectionState: 'connected' | 'failed'
): void {
  voiceChannel?.push('report_ice_stats', {
    candidate_type: candidateType,
    connection_state: connectionState,
  });
}

export interface UserChannelCallbacks {
  onNewMessage: (payload: NewMessageNotification) => void;
  onServerDeleted: (payload: ServerDeletedNotification) => void;
  onMemberKicked: (payload: MemberKickedNotification) => void;
  onMemberStatusChanged: (payload: MemberStatusChangedNotification) => void;
  onFriendRequestReceived: (payload: Friendship) => void;
  onFriendRequestAccepted: (payload: Friendship) => void;
  onFriendRemoved: (payload: FriendRemovedNotification) => void;
  onNewDmMessage: (payload: NewDmMessageNotification) => void;
}

/**
 * Joins the user's personal notification topic — carries events meant for
 * this user specifically, regardless of which server/channel they currently
 * have open: new messages (see ChatChannel's `notify_other_members/3`),
 * "you've been kicked"/"this server was deleted" (still personal — the
 * affected user must find out even if they aren't currently viewing that
 * server), friend requests, and DMs. Server-wide events that everyone
 * *currently viewing* a server should see live (channel created/deleted,
 * server renamed, a member left) now go through `joinServerChannel` instead
 * — see `Backend.Servers` for the broadcast side of that split.
 */
export function joinUserChannel(userId: string, callbacks: UserChannelCallbacks): () => void {
  const s = getSocket();
  const room = s.channel(`user:${userId}`, {});
  userChannel = room;

  room.on('new_message', (payload: NewMessageNotification) => callbacks.onNewMessage(payload));
  room.on('server_deleted', (payload: ServerDeletedNotification) =>
    callbacks.onServerDeleted(payload)
  );
  room.on('member_kicked', (payload: MemberKickedNotification) =>
    callbacks.onMemberKicked(payload)
  );
  room.on('member_status_changed', (payload: MemberStatusChangedNotification) =>
    callbacks.onMemberStatusChanged(payload)
  );
  room.on('friend_request_received', (payload: Friendship) => callbacks.onFriendRequestReceived(payload));
  room.on('friend_request_accepted', (payload: Friendship) => callbacks.onFriendRequestAccepted(payload));
  room.on('friend_removed', (payload: FriendRemovedNotification) => callbacks.onFriendRemoved(payload));
  room.on('new_dm_message', (payload: NewDmMessageNotification) => callbacks.onNewDmMessage(payload));
  room.join();

  return () => {
    room.leave();
    if (userChannel === room) userChannel = null;
  };
}

export interface ServerChannelCallbacks {
  onChannelCreated: (payload: ChannelCreatedNotification) => void;
  onChannelDeleted: (payload: ChannelDeletedNotification) => void;
  onChannelPositionsUpdated: (payload: ChannelPositionsUpdatedNotification) => void;
  onServerUpdated: (payload: ServerUpdatedNotification) => void;
  onMemberLeft: (payload: MemberLeftNotification) => void;
}

/**
 * Joins a server's shared topic (by server id) — every member currently
 * viewing this server joins the same topic, so `Backend.Servers` broadcasts
 * these events once instead of fanning them out to each member's personal
 * channel. Purely a broadcast relay (no join response payload, unlike the
 * chat/dm channels) — the client never pushes anything to it.
 */
export function joinServerChannel(serverId: string, callbacks: ServerChannelCallbacks): () => void {
  const s = getSocket();
  const room = s.channel(`server:${serverId}`, {});
  serverChannel = room;

  room.on('channel_created', (payload: ChannelCreatedNotification) => callbacks.onChannelCreated(payload));
  room.on('channel_deleted', (payload: ChannelDeletedNotification) => callbacks.onChannelDeleted(payload));
  room.on('channel_positions_updated', (payload: ChannelPositionsUpdatedNotification) =>
    callbacks.onChannelPositionsUpdated(payload)
  );
  room.on('server_updated', (payload: ServerUpdatedNotification) => callbacks.onServerUpdated(payload));
  room.on('member_left', (payload: MemberLeftNotification) => callbacks.onMemberLeft(payload));
  room.join();

  return () => {
    room.leave();
    if (serverChannel === room) serverChannel = null;
  };
}

export function disconnectSocket(): void {
  textChannel?.leave();
  textChannel = null;
  voiceChannel?.leave();
  voiceChannel = null;
  userChannel?.leave();
  userChannel = null;
  dmChannel?.leave();
  dmChannel = null;
  serverChannel?.leave();
  serverChannel = null;
  socket?.disconnect();
  socket = null;
}
