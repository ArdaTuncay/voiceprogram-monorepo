import { Socket, Channel, Presence } from 'phoenix';
import type {
  ChatMessage,
  PresenceUser,
  VoiceSignalPayload,
  NewMessageNotification,
  TypingNotification,
  ChannelDeletedNotification,
  ServerUpdatedNotification,
  ServerDeletedNotification,
  MemberKickedNotification,
} from '../types';
import { getStoredToken } from './api';
import { resolveSocketUrl } from '../config';

let socket: Socket | null = null;
let textChannel: Channel | null = null;
let voiceChannel: Channel | null = null;
let userChannel: Channel | null = null;

function getSocket(): Socket {
  if (!socket) {
    // Same-origin (Vite dev proxy / ngrok tunnel) unless VITE_API_URL points
    // at a separately-deployed backend — see src/config.ts.
    // A function (not a plain object) so a reconnect always re-reads the
    // latest token from localStorage instead of a value captured at startup.
    socket = new Socket(resolveSocketUrl(), { params: () => ({ token: getStoredToken() }) });
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

export interface UserChannelCallbacks {
  onNewMessage: (payload: NewMessageNotification) => void;
  onChannelDeleted: (payload: ChannelDeletedNotification) => void;
  onServerUpdated: (payload: ServerUpdatedNotification) => void;
  onServerDeleted: (payload: ServerDeletedNotification) => void;
  onMemberKicked: (payload: MemberKickedNotification) => void;
}

/**
 * Joins the user's personal notification topic — carries events meant for
 * this user regardless of which server/channel they currently have open:
 * new messages (see ChatChannel's `notify_other_members/3`), and server
 * admin actions (rename/delete, channel delete, member kick — see
 * `Backend.Servers`).
 */
export function joinUserChannel(userId: string, callbacks: UserChannelCallbacks): () => void {
  const s = getSocket();
  const room = s.channel(`user:${userId}`, {});
  userChannel = room;

  room.on('new_message', (payload: NewMessageNotification) => callbacks.onNewMessage(payload));
  room.on('channel_deleted', (payload: ChannelDeletedNotification) =>
    callbacks.onChannelDeleted(payload)
  );
  room.on('server_updated', (payload: ServerUpdatedNotification) =>
    callbacks.onServerUpdated(payload)
  );
  room.on('server_deleted', (payload: ServerDeletedNotification) =>
    callbacks.onServerDeleted(payload)
  );
  room.on('member_kicked', (payload: MemberKickedNotification) =>
    callbacks.onMemberKicked(payload)
  );
  room.join();

  return () => {
    room.leave();
    if (userChannel === room) userChannel = null;
  };
}

export function disconnectSocket(): void {
  textChannel?.leave();
  textChannel = null;
  voiceChannel?.leave();
  voiceChannel = null;
  userChannel?.leave();
  userChannel = null;
  socket?.disconnect();
  socket = null;
}
