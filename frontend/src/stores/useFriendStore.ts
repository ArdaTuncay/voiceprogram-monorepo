import { create } from 'zustand';
import type { Friendship } from '../types';
import {
  fetchFriends,
  sendFriendRequest as apiSendFriendRequest,
  acceptFriendRequest as apiAcceptFriendRequest,
  removeFriendship as apiRemoveFriendship,
} from '../services/api';

function upsert(list: Friendship[], next: Friendship): Friendship[] {
  const index = list.findIndex((f) => f.id === next.id);
  if (index === -1) return [...list, next];
  const copy = [...list];
  copy[index] = next;
  return copy;
}

interface FriendStoreState {
  friendships: Friendship[];
  loading: boolean;
  error: string;

  loadFriendships: () => Promise<void>;
  refreshFriendships: () => Promise<void>;
  sendRequest: (username: string) => Promise<string | undefined>;
  acceptRequest: (friendshipId: string) => Promise<string | undefined>;
  removeFriendship: (friendshipId: string) => Promise<string | undefined>;
  /** Wipes this store back to its initial state — called on a forced logout
   * (see services/session.ts) so nothing from this session leaks into
   * whatever comes next in the same tab (a fresh login, or a different
   * account entirely). */
  reset: () => void;

  // Reducers driven by the personal "user:<id>" socket topic — see
  // stores/useSocketStore.ts, which wires these to the actual events.
  handleFriendRequestReceived: (payload: Friendship) => void;
  handleFriendRequestAccepted: (payload: Friendship) => void;
  handleFriendRemoved: (payload: { id: string }) => void;
}

export const useFriendStore = create<FriendStoreState>((set, get) => ({
  friendships: [],
  loading: false,
  error: '',

  loadFriendships: async () => {
    set({ loading: true, error: '' });
    const { data, error } = await fetchFriends();
    set({ loading: false });

    if (error || !data) {
      set({ error: error ?? 'Arkadaş listesi alınamadı' });
      return;
    }
    set({ friendships: data });
  },

  // Silent variant of loadFriendships, used to resync after a socket
  // reconnect (see useSocketSync) — skips the `loading: true` flip so it
  // doesn't flash FriendsPanel's "Yükleniyor…" placeholder over an already-
  // populated list, and swallows errors since a background best-effort
  // refresh failing shouldn't surface as a user-facing error banner.
  refreshFriendships: async () => {
    const { data } = await fetchFriends();
    if (data) set({ friendships: data });
  },

  sendRequest: async (username) => {
    const { data, error } = await apiSendFriendRequest(username);
    if (error || !data) return error ?? 'İstek gönderilemedi';

    set((state) => ({ friendships: upsert(state.friendships, data) }));
    return undefined;
  },

  acceptRequest: async (friendshipId) => {
    const { data, error } = await apiAcceptFriendRequest(friendshipId);
    if (error || !data) return error ?? 'İstek kabul edilemedi';

    set((state) => ({ friendships: upsert(state.friendships, data) }));
    return undefined;
  },

  removeFriendship: async (friendshipId) => {
    const { error } = await apiRemoveFriendship(friendshipId);
    if (error) return error;

    get().handleFriendRemoved({ id: friendshipId });
    return undefined;
  },

  handleFriendRequestReceived: (payload) =>
    set((state) => ({ friendships: upsert(state.friendships, payload) })),

  handleFriendRequestAccepted: (payload) =>
    set((state) => ({ friendships: upsert(state.friendships, payload) })),

  handleFriendRemoved: (payload) =>
    set((state) => ({ friendships: state.friendships.filter((f) => f.id !== payload.id) })),

  reset: () => set({ friendships: [], loading: false, error: '' }),
}));
