export interface User {
  id: string;
  username: string;
  email: string;
}

export interface AuthResponse extends User {
  token: string;
}

export interface ChatMessage {
  id: string;
  content: string;
  file_url: string | null;
  file_type: string | null;
  user_id: string;
  username: string | null;
  inserted_at: string;
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

export interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
}

export interface Server {
  id: string;
  name: string;
  owner_id: string;
}

export interface ServerMember {
  user_id: string;
  username: string | null;
  role: 'owner' | 'member';
}

export interface ChannelDeletedNotification {
  channel_id: string;
  server_id: string;
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

export interface ApiError {
  error?: string;
  errors?: Record<string, string[]>;
}
