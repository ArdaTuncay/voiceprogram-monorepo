import { create } from 'zustand';
import { useDMStore } from './useDMStore';
import type {
  Server,
  Channel,
  ChannelType,
  ChannelCreatedNotification,
  ChannelDeletedNotification,
  ChannelPositionsUpdatedNotification,
  ServerUpdatedNotification,
  MemberLeftNotification,
  MemberStatusChangedNotification,
  UserStatus,
} from '../types';
import {
  fetchServers,
  createServer as apiCreateServer,
  fetchServerChannels,
  fetchServerMembers,
  acceptInvite,
  createChannel as apiCreateChannel,
  updateChannelPositions as apiUpdateChannelPositions,
  type ChannelPositionUpdate,
  leaveServer as apiLeaveServer,
} from '../services/api';

/** A category (`type: 'category'`) paired with the channels grouped under
 * it, in display order — plus one leading group with `category: null` for
 * channels with no `parent_id` ("Kategorisiz"). Pure derivation from the
 * flat `channels` list; kept out of store state since it's just a view over
 * data the store already has, recomputed on demand rather than kept in sync. */
export interface ChannelGroup {
  category: Channel | null;
  channels: Channel[];
}

function byPosition(a: Channel, b: Channel): number {
  return a.position - b.position || a.name.localeCompare(b.name);
}

export function groupChannelsByCategory(channels: Channel[]): ChannelGroup[] {
  const categories = channels.filter((c) => c.type === 'category').sort(byPosition);
  const uncategorized = channels.filter((c) => c.type !== 'category' && !c.parent_id).sort(byPosition);

  const groups: ChannelGroup[] = [{ category: null, channels: uncategorized }];

  for (const category of categories) {
    const subChannels = channels
      .filter((c) => c.type !== 'category' && c.parent_id === category.id)
      .sort(byPosition);
    groups.push({ category, channels: subChannels });
  }

  return groups;
}

interface ServerStoreState {
  servers: Server[];
  activeServerId: string | null;
  channels: Channel[];
  activeChannelId: string | null;
  unreadChannelIds: Set<string>;
  /** Servers (other than the one currently open) with an unread message
   * somewhere in one of their channels — drives the red dot on
   * ServerSidebar's icons. Cleared when the user switches into that server. */
  unreadServerIds: Set<string>;
  /** Live online/offline status per user id, fed by "member_status_changed"
   * broadcasts (see BackendWeb.UserChannel) — merged in wherever a member
   * list is rendered (e.g. ServerSettingsModal's Members tab), overriding
   * whatever status was last fetched for that user. */
  memberStatuses: Record<string, UserStatus>;
  channelError: string;
  /** Set by `navigateToNotification` for a cross-server jump: tells the
   * channel-load that follows a server switch which channel to select
   * instead of defaulting to the new server's first text channel. */
  pendingChannelId: string | null;

  setChannelError: (message: string) => void;
  markUnread: (channelId: string) => void;
  markRead: (channelId: string) => void;
  markServerUnread: (serverId: string) => void;

  loadServers: () => Promise<void>;
  setActiveServerId: (serverId: string | null) => void;
  loadChannelsForActiveServer: () => Promise<void>;
  resyncActiveServer: () => Promise<void>;
  selectChannel: (channelId: string) => void;
  navigateToNotification: (serverId: string, channelId: string) => void;

  createServer: (name: string) => Promise<string | undefined>;
  joinServerByInvite: (code: string) => Promise<string | undefined>;
  createChannel: (name: string, type: ChannelType, parentId?: string | null) => Promise<string | undefined>;
  /** Bulk-moves/reorders channels (see `services/api.ts`'s `updateChannelPositions`)
   * — the new list appears once the "channel_positions_updated" broadcast
   * reaches handleChannelPositionsUpdated below, same "server echoes it
   * back" convention as createChannel. */
  updateChannelPositions: (updates: ChannelPositionUpdate[]) => Promise<string | undefined>;
  leaveServer: () => Promise<string | undefined>;
  /** Wipes this store back to its initial state — called on a forced logout
   * (see services/session.ts) so nothing from this session leaks into
   * whatever comes next in the same tab (a fresh login, or a different
   * account entirely). */
  reset: () => void;

  // Reducers driven by the shared "server:<id>" socket topic (see
  // BackendWeb.ServerChannel) — stores/useSocketStore.ts wires these to the
  // actual events. Only live while the user has this server open; members
  // elsewhere pick up the change next time they load this server.
  handleChannelCreated: (payload: ChannelCreatedNotification) => void;
  handleChannelDeleted: (payload: ChannelDeletedNotification) => void;
  handleChannelPositionsUpdated: (payload: ChannelPositionsUpdatedNotification) => void;
  handleServerUpdated: (payload: ServerUpdatedNotification) => void;
  /** No global state currently depends on this — reserved for a live-updating
   * member list (e.g. ServerSettingsModal's Members tab) to consume later. */
  handleMemberLeft: (payload: MemberLeftNotification) => void;

  // Reducer driven by the personal "user:<id>" socket topic instead — see
  // stores/useSocketStore.ts.
  handleMemberStatusChanged: (payload: MemberStatusChangedNotification) => void;
  /** Shared by "server_deleted" and "member_kicked" (when it's me) — both
   * boil down to "this server is gone from under me". */
  removeServerAndDeselect: (serverId: string) => void;
}

export const useServerStore = create<ServerStoreState>((set, get) => ({
  servers: [],
  activeServerId: null,
  channels: [],
  activeChannelId: null,
  unreadChannelIds: new Set(),
  unreadServerIds: new Set(),
  memberStatuses: {},
  channelError: '',
  pendingChannelId: null,

  setChannelError: (message) => set({ channelError: message }),

  markUnread: (channelId) =>
    set((state) => ({ unreadChannelIds: new Set(state.unreadChannelIds).add(channelId) })),

  markRead: (channelId) =>
    set((state) => {
      if (!state.unreadChannelIds.has(channelId)) return state;
      const next = new Set(state.unreadChannelIds);
      next.delete(channelId);
      return { unreadChannelIds: next };
    }),

  markServerUnread: (serverId) =>
    set((state) => {
      if (state.unreadServerIds.has(serverId)) return state;
      return { unreadServerIds: new Set(state.unreadServerIds).add(serverId) };
    }),

  loadServers: async () => {
    const { data, error } = await fetchServers();
    if (error) {
      set({ channelError: error });
      return;
    }
    set((state) => ({
      servers: data ?? [],
      activeServerId: state.activeServerId ?? data?.[0]?.id ?? null,
    }));
    if (get().activeServerId) get().loadChannelsForActiveServer();
  },

  setActiveServerId: (serverId) => {
    set((state) => {
      if (!serverId || !state.unreadServerIds.has(serverId)) return { activeServerId: serverId };
      const nextUnreadServerIds = new Set(state.unreadServerIds);
      nextUnreadServerIds.delete(serverId);
      return { activeServerId: serverId, unreadServerIds: nextUnreadServerIds };
    });
    // Servers and DMs are mutually exclusive views — picking a server, or
    // returning to the DM/Friends area from one, both mean whatever DM
    // room was previously open is no longer being viewed. Without this,
    // useDMStore's activeRoomId stayed stuck on that room forever (nothing
    // else ever cleared it — see stores/useSocketStore.ts's onNewDmMessage
    // guard), permanently suppressing that room's notifications even after
    // the user had long since left it.
    useDMStore.getState().setActiveRoomId(null);
    if (!serverId) {
      set({ channels: [], activeChannelId: null });
      return;
    }
    get().loadChannelsForActiveServer();
  },

  loadChannelsForActiveServer: async () => {
    const serverId = get().activeServerId;
    if (!serverId) return;

    const { data, error } = await fetchServerChannels(serverId);
    // The user may have switched servers again while this was in flight —
    // don't clobber the (now current) channel list with a stale response.
    if (get().activeServerId !== serverId) return;

    if (error || !data) {
      set({ channelError: error ?? 'No channels available' });
      return;
    }

    const pendingChannelId = get().pendingChannelId;
    const currentActiveChannelId = get().activeChannelId;
    // Priority: an explicit cross-server navigation target, then whatever
    // channel is already open (still valid after a silent resync — e.g.
    // after a reconnect, see resyncActiveServer below — so it doesn't
    // snap back to the first text channel while the user is mid-read),
    // then falling back to the first text channel (the original-load and
    // server-switch case, where the previous server's channel id never
    // matches one in the new list anyway).
    const nextActiveChannelId =
      pendingChannelId && data.some((c) => c.id === pendingChannelId)
        ? pendingChannelId
        : currentActiveChannelId && data.some((c) => c.id === currentActiveChannelId)
          ? currentActiveChannelId
          : (data.find((c) => c.type === 'text')?.id ?? null);

    set({ channels: data, activeChannelId: nextActiveChannelId, pendingChannelId: null });
  },

  // Silently re-syncs the active server's channel list and member statuses
  // — called after a socket reconnect (see useSocketSync) to catch drift
  // that happened while disconnected (a channel created/deleted, a
  // member's status changing) that plain channel rejoin doesn't cover.
  // No-ops with no active server; swallows fetch errors since this is a
  // best-effort background refresh, not a user-initiated action.
  resyncActiveServer: async () => {
    const serverId = get().activeServerId;
    if (!serverId) return;

    await get().loadChannelsForActiveServer();

    const { data } = await fetchServerMembers(serverId);
    if (get().activeServerId !== serverId || !data) return;
    set((state) => ({
      memberStatuses: {
        ...state.memberStatuses,
        ...Object.fromEntries(data.map((m) => [m.user_id, m.status])),
      },
    }));
  },

  selectChannel: (channelId) => {
    get().markRead(channelId);
    set({ activeChannelId: channelId });
  },

  navigateToNotification: (serverId, channelId) => {
    get().markRead(channelId);
    if (serverId === get().activeServerId) {
      set({ activeChannelId: channelId });
    } else {
      set({ pendingChannelId: channelId });
      get().setActiveServerId(serverId);
    }
  },

  createServer: async (name) => {
    const { data, error } = await apiCreateServer(name);
    if (error || !data) return error ?? 'Failed to create server';

    set((state) => ({ servers: [...state.servers, data] }));
    get().setActiveServerId(data.id);
    return undefined;
  },

  joinServerByInvite: async (code) => {
    const { data, error } = await acceptInvite(code);
    if (error || !data) return error ?? 'Failed to join server';

    set((state) => (state.servers.some((s) => s.id === data.id) ? state : { servers: [...state.servers, data] }));
    get().setActiveServerId(data.id);
    return undefined;
  },

  createChannel: async (name, type, parentId) => {
    const serverId = get().activeServerId;
    if (!serverId) return 'No active server';

    const { error } = await apiCreateChannel(serverId, name, type, parentId);
    // On success the new channel appears once the "channel_created" broadcast
    // reaches handleChannelCreated below — see Backend.Servers.create_channel/2.
    return error;
  },

  updateChannelPositions: async (updates) => {
    const serverId = get().activeServerId;
    if (!serverId) return 'No active server';

    const { error } = await apiUpdateChannelPositions(serverId, updates);
    // On success the reordered list appears once the
    // "channel_positions_updated" broadcast reaches
    // handleChannelPositionsUpdated below — see
    // Backend.Servers.update_channel_positions/2.
    return error;
  },

  leaveServer: async () => {
    const serverId = get().activeServerId;
    if (!serverId) return 'No active server';

    const { error } = await apiLeaveServer(serverId);
    if (error) return error;

    get().removeServerAndDeselect(serverId);
    return undefined;
  },

  handleChannelCreated: (payload) => {
    if (payload.server_id !== get().activeServerId) return;
    set((state) =>
      state.channels.some((c) => c.id === payload.id) ? state : { channels: [...state.channels, payload] }
    );
  },

  handleChannelDeleted: (payload) => {
    const state = get();
    const stillPresent = state.channels.some((c) => c.id === payload.channel_id);
    if (!stillPresent) return;

    const remaining = state.channels.filter((c) => c.id !== payload.channel_id);
    const nextUnread = new Set(state.unreadChannelIds);
    nextUnread.delete(payload.channel_id);
    const nextActiveChannelId =
      state.activeChannelId === payload.channel_id
        ? (remaining.find((c) => c.type === 'text')?.id ?? null)
        : state.activeChannelId;

    set({ channels: remaining, unreadChannelIds: nextUnread, activeChannelId: nextActiveChannelId });
  },

  handleChannelPositionsUpdated: (payload) => {
    if (payload.server_id !== get().activeServerId) return;
    set({ channels: payload.channels });
  },

  handleServerUpdated: (payload) => {
    set((state) => ({
      servers: state.servers.map((s) => (s.id === payload.server_id ? { ...s, name: payload.name } : s)),
    }));
  },

  handleMemberStatusChanged: (payload) => {
    set((state) => ({
      memberStatuses: { ...state.memberStatuses, [payload.user_id]: payload.status },
    }));
  },

  handleMemberLeft: (_payload) => {
    // Intentionally a no-op for now — see the interface doc above.
  },

  removeServerAndDeselect: (serverId) => {
    set((state) => {
      const nextUnreadServerIds = new Set(state.unreadServerIds);
      nextUnreadServerIds.delete(serverId);
      return {
        servers: state.servers.filter((s) => s.id !== serverId),
        activeServerId: state.activeServerId === serverId ? null : state.activeServerId,
        channels: state.activeServerId === serverId ? [] : state.channels,
        activeChannelId: state.activeServerId === serverId ? null : state.activeChannelId,
        unreadServerIds: nextUnreadServerIds,
      };
    });
  },

  reset: () =>
    set({
      servers: [],
      activeServerId: null,
      channels: [],
      activeChannelId: null,
      unreadChannelIds: new Set(),
      unreadServerIds: new Set(),
      memberStatuses: {},
      channelError: '',
      pendingChannelId: null,
    }),
}));
