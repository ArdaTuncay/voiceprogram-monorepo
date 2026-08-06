import { useEffect } from 'react';
import type { User } from '../types';
import { useServerStore } from './useServerStore';
import { useChatStore } from './useChatStore';
import { useFriendStore } from './useFriendStore';
import { useDMStore } from './useDMStore';
import { useConnectionStore } from './useConnectionStore';
import { joinChatChannel, joinUserChannel, joinDmChannel, joinServerChannel } from '../services/socket';
import {
  getNotificationPreferences,
  isMentioned,
  playNotificationSound,
} from '../services/notificationPreferences';

/**
 * Owns every Phoenix-channel side effect for the whole session: joining the
 * active text channel's topic whenever it changes, and joining the user's
 * personal "user:<id>" notification/moderation topic once. Call exactly
 * once, from Chat.tsx.
 *
 * Every callback below reads current state via `getState()` instead of
 * closing over React state or props — this is what lets it dodge the
 * stale-closure problem that the pre-Zustand version needed a small pile of
 * refs (`activeChannelIdRef`, `channelsRef`, `activeServerIdRef`,
 * `pendingChannelIdRef`, `handleNotificationNavigateRef`) to work around.
 */
export function useSocketSync(currentUser: User): void {
  const userId = currentUser.id;
  const activeChannelId = useServerStore((state) => state.activeChannelId);
  const activeServerId = useServerStore((state) => state.activeServerId);
  const activeRoomId = useDMStore((state) => state.activeRoomId);
  const reconnectedAt = useConnectionStore((state) => state.reconnectedAt);

  useEffect(() => {
    useChatStore.getState().resetForChannelSwitch();
    if (!activeChannelId) return;

    const cleanup = joinChatChannel(activeChannelId, {
      onJoined: (resp) => {
        useChatStore.getState().setMessages(resp.messages);
        useServerStore.getState().setChannelError('');
      },
      onShout: (msg) => useChatStore.getState().addMessage(msg),
      onError: (reason) => useServerStore.getState().setChannelError(reason),
      onPresenceChange: (users) => useChatStore.getState().setOnlineUsers(users),
      onTyping: (payload) =>
        useChatStore.getState().setTypingUser(payload.user_id, payload.username, payload.is_typing),
      onReactionToggled: (payload) => useChatStore.getState().handleReactionToggled(payload),
      onMessageUpdated: (msg) => useChatStore.getState().handleMessageUpdated(msg),
      onMessageDeleted: (msg) => useChatStore.getState().handleMessageDeleted(msg),
    });
    return cleanup;
  }, [activeChannelId]);

  // Joins the active server's shared "server:<id>" topic (see
  // BackendWeb.ServerChannel) — every member currently viewing a server
  // joins the same topic, so Backend.Servers broadcasts channel/server
  // changes once instead of fanning them out to each member's personal
  // channel. Leaves the old topic and joins the new one whenever the active
  // server changes; leaves entirely when there's no active server (DM view).
  useEffect(() => {
    if (!activeServerId) return;

    const cleanup = joinServerChannel(activeServerId, {
      onChannelCreated: (payload) => useServerStore.getState().handleChannelCreated(payload),
      onChannelDeleted: (payload) => useServerStore.getState().handleChannelDeleted(payload),
      onChannelPositionsUpdated: (payload) =>
        useServerStore.getState().handleChannelPositionsUpdated(payload),
      onServerUpdated: (payload) => useServerStore.getState().handleServerUpdated(payload),
      onMemberLeft: (payload) => useServerStore.getState().handleMemberLeft(payload),
      onVoicePresenceUpdated: (payload) =>
        useServerStore.getState().handleVoicePresenceUpdated(payload),
    });
    return cleanup;
  }, [activeServerId]);

  // Mirrors the text-channel effect above, for the active DM room instead —
  // BackendWeb.DmChannel has the same join/shout/typing/presence shape as
  // ChatChannel, so this is a near-identical join.
  useEffect(() => {
    useDMStore.getState().resetForRoomSwitch();
    if (!activeRoomId) return;

    const cleanup = joinDmChannel(activeRoomId, {
      onJoined: (resp) => {
        useDMStore.getState().setMessages(resp.messages);
        // Deliberately after setMessages, not from setActiveRoomId itself —
        // that fires synchronously, before this join's messages (the ones
        // markRoomRead needs to find the true latest seq in) have loaded,
        // which risked marking the room read against a stale/empty message
        // list (or briefly a *different* room's, left over from before this
        // switch). This is the first point where `messages` is guaranteed
        // to actually belong to `activeRoomId`.
        useDMStore.getState().markRoomRead(activeRoomId);
      },
      onShout: (msg) => useDMStore.getState().addMessage(msg),
      onError: () => {},
      onPresenceChange: () => {},
      onTyping: (payload) =>
        useDMStore.getState().setTyping(payload.is_typing ? payload.username : null),
      onReactionToggled: (payload) => useDMStore.getState().handleReactionToggled(payload),
      onMessageUpdated: (msg) => useDMStore.getState().handleMessageUpdated(msg),
      onMessageDeleted: (msg) => useDMStore.getState().handleMessageDeleted(msg),
    });
    return cleanup;
  }, [activeRoomId]);

  // Re-syncs REST-backed state after a genuine socket reconnect (see
  // useConnectionStore's reconnectedAt — bumped by services/socket.ts's
  // onOpen only when the socket was open before, never on the first
  // connect). Channel/DM/server-topic rejoin above already re-syncs
  // whatever rides on a channel's join reply or presence automatically
  // (that's plain Phoenix behavior), but it can't refresh things that only
  // ever get fetched over REST — the friends list (including requests that
  // arrived while disconnected) and the active server's channel/member
  // list — so those are explicitly re-fetched here instead. Both run
  // silently in the background (see refreshFriendships/resyncActiveServer).
  useEffect(() => {
    if (!reconnectedAt) return;
    void useFriendStore.getState().refreshFriendships();
    void useServerStore.getState().resyncActiveServer();
  }, [reconnectedAt]);

  // Joins the personal notification topic once for the whole session — it
  // carries messages for every channel across every server the user is in
  // (not just the one currently open) plus every server-moderation event
  // (see Backend.Servers), regardless of what's on screen right now.
  useEffect(() => {
    const cleanup = joinUserChannel(userId, {
      onNewMessage: (payload) => {
        if (payload.channel_id === useServerStore.getState().activeChannelId) return;

        useServerStore.getState().markUnread(payload.channel_id);
        if (payload.server_id !== useServerStore.getState().activeServerId) {
          useServerStore.getState().markServerUnread(payload.server_id);
        }

        const prefs = getNotificationPreferences();
        if (!prefs.enabled) return;
        if (prefs.mentionsOnly && !isMentioned(payload.content, currentUser.username)) return;

        if (prefs.sound) playNotificationSound();

        if (prefs.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const notification = new Notification(
            `#${payload.channel_name} — ${payload.username ?? 'Bilinmeyen'}`,
            { body: payload.content, tag: payload.channel_id, renotify: true }
          );
          notification.onclick = () => {
            window.focus();
            useServerStore.getState().navigateToNotification(payload.server_id, payload.channel_id);
            notification.close();
          };
        }
      },
      onServerDeleted: (payload) => useServerStore.getState().removeServerAndDeselect(payload.server_id),
      // Only ever broadcast to the kicked user's own personal channel (see
      // Backend.Servers.kick_member/2) — always about "me", no filter needed.
      onMemberKicked: (payload) => useServerStore.getState().removeServerAndDeselect(payload.server_id),
      onMemberStatusChanged: (payload) => useServerStore.getState().handleMemberStatusChanged(payload),
      onFriendRequestReceived: (payload) => useFriendStore.getState().handleFriendRequestReceived(payload),
      onFriendRequestAccepted: (payload) => useFriendStore.getState().handleFriendRequestAccepted(payload),
      onFriendRemoved: (payload) => useFriendStore.getState().handleFriendRemoved(payload),
      onNewDmMessage: (payload) => {
        useDMStore.getState().handleNewDmMessage(payload);

        if (payload.dm_room_id === useDMStore.getState().activeRoomId) return;

        const prefs = getNotificationPreferences();
        // mentionsOnly doesn't apply here — a DM is always "about you" by
        // definition, there's no @-mention concept in a 1:1 conversation.
        if (!prefs.enabled) return;

        if (prefs.sound) playNotificationSound();

        if (prefs.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const notification = new Notification(payload.username ?? 'Bilinmeyen', {
            body: payload.content,
            tag: payload.dm_room_id,
            renotify: true,
          });
          notification.onclick = () => {
            window.focus();
            useServerStore.getState().setActiveServerId(null);
            useDMStore.getState().setActiveRoomId(payload.dm_room_id);
            notification.close();
          };
        }
      },
    });
    return cleanup;
  }, [userId]);
}
