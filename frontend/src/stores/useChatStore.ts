import { create } from 'zustand';
import type { ChatMessage, PresenceUser, ReactionToggledPayload, SearchFilters } from '../types';
import { shout, sendTyping, toggleReaction, editMessage } from '../services/socket';
import { fetchChannelMessages, searchChannelMessages, uploadFile } from '../services/api';
import { useServerStore } from './useServerStore';

// Safety cap on how many older pages jumpToMessage will fetch while hunting
// for a search result that isn't in the currently loaded window, so a
// message from very early channel history can't spin the loop forever.
const MAX_JUMP_PAGE_FETCHES = 20;

// The channel-join socket response and the REST pagination endpoint both cap
// a page at this many messages — used here to infer `hasMoreMessages` from
// a page that came back short.
const MESSAGE_PAGE_SIZE = 50;

// How long to wait after the last keystroke before telling the channel the
// user stopped typing. Plain module state (not store state) — it never
// needs to trigger a re-render, only the debounce logic below cares.
const TYPING_STOP_DELAY_MS = 2000;
let isTyping = false;
let typingStopTimer: number | null = null;

function clearTypingTimer() {
  if (typingStopTimer !== null) {
    window.clearTimeout(typingStopTimer);
    typingStopTimer = null;
  }
}

interface ChatStoreState {
  messages: ChatMessage[];
  draft: string;
  onlineUsers: PresenceUser[];
  typingUsers: Record<string, string | null>;
  isUploading: boolean;
  uploadError: string;
  isDraggingFile: boolean;
  lightboxUrl: string | null;
  /** Whether an older page of history is known to exist for the active
   * channel — false once a fetch comes back short of a full page. */
  hasMoreMessages: boolean;
  isLoadingOlderMessages: boolean;

  /** Search-panel state — driven by the channel header's search bar. */
  searchQuery: string;
  searchResults: ChatMessage[];
  isSearching: boolean;
  isSearchPanelOpen: boolean;
  /** The message id to flash-highlight in the message list, set by
   * `jumpToMessage` once the target message is confirmed loaded. */
  highlightedMessageId: string | null;

  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
  /** Fetches the 50 messages older than the current oldest loaded message
   * and prepends them — the infinite-scroll-upward action. No-op if a fetch
   * is already in flight, there's no active channel, or the last fetch
   * indicated no older history remains. */
  loadOlderMessages: () => Promise<void>;
  /** Clears the active channel's live view — called both when switching to
   * a new channel and when leaving the last one (activeChannelId -> null). */
  resetForChannelSwitch: () => void;

  setSearchQuery: (query: string) => void;
  /** Runs a search against the active channel and opens the results panel. */
  searchChannelMessages: (channelId: string, filters: SearchFilters) => Promise<void>;
  closeSearchPanel: () => void;
  /** Brings `messageId` into the loaded `messages` window (fetching older
   * pages if needed, up to a safety cap) and flash-highlights it — the
   * "jump to this message" action from a search result. Closes the search
   * panel regardless of whether the message was ultimately found. */
  jumpToMessage: (messageId: string) => Promise<void>;
  clearHighlight: () => void;

  setOnlineUsers: (users: PresenceUser[]) => void;
  setTypingUser: (userId: string, username: string | null, isTyping: boolean) => void;

  setDraft: (value: string) => void;
  handleDraftChange: (value: string) => void;
  stopTypingNow: () => void;
  sendMessage: () => void;
  handleFileSelected: (file: File) => Promise<void>;

  setDraggingFile: (value: boolean) => void;
  setLightboxUrl: (url: string | null) => void;

  toggleReaction: (messageId: string, emoji: string) => void;
  // Reducer driven by the channel's "reaction_toggled" socket event — see
  // stores/useSocketStore.ts.
  handleReactionToggled: (payload: ReactionToggledPayload) => void;

  editMessage: (messageId: string, content: string) => void;
  // Reducer driven by the channel's "message_updated" socket event — see
  // stores/useSocketStore.ts. Replaces the message by id in place, wherever
  // it currently sits in the list (server echoes the edit back to the
  // author too, same "single source of truth via the broadcast" convention
  // as handleReactionToggled).
  handleMessageUpdated: (msg: ChatMessage) => void;

  /** Wipes this store back to its initial state — called on a forced logout
   * (see services/session.ts) so nothing from this session leaks into
   * whatever comes next in the same tab (a fresh login, or a different
   * account entirely). */
  reset: () => void;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  messages: [],
  draft: '',
  onlineUsers: [],
  typingUsers: {},
  isUploading: false,
  uploadError: '',
  isDraggingFile: false,
  lightboxUrl: null,
  hasMoreMessages: true,
  isLoadingOlderMessages: false,

  searchQuery: '',
  searchResults: [],
  isSearching: false,
  isSearchPanelOpen: false,
  highlightedMessageId: null,

  setMessages: (messages) => set({ messages, hasMoreMessages: messages.length >= MESSAGE_PAGE_SIZE }),
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

  loadOlderMessages: async () => {
    const state = get();
    if (state.isLoadingOlderMessages || !state.hasMoreMessages || state.messages.length === 0) return;

    const activeServerId = useServerStore.getState().activeServerId;
    const activeChannelId = useServerStore.getState().activeChannelId;
    if (!activeServerId || !activeChannelId) return;

    const oldestId = state.messages[0].id;
    set({ isLoadingOlderMessages: true });
    const { data, error } = await fetchChannelMessages(activeServerId, activeChannelId, oldestId);
    set({ isLoadingOlderMessages: false });
    if (error || !data) return;

    // The active channel may have changed while the fetch was in flight —
    // don't splice an older page from channel A onto channel B's history.
    if (useServerStore.getState().activeChannelId !== activeChannelId) return;

    set((s) => ({
      messages: [...data.messages, ...s.messages],
      hasMoreMessages: data.has_more,
    }));
  },

  resetForChannelSwitch: () => {
    clearTypingTimer();
    isTyping = false;
    set({
      messages: [],
      onlineUsers: [],
      typingUsers: {},
      hasMoreMessages: true,
      isLoadingOlderMessages: false,
      searchQuery: '',
      searchResults: [],
      isSearching: false,
      isSearchPanelOpen: false,
      highlightedMessageId: null,
    });
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  searchChannelMessages: async (channelId, filters) => {
    set({ isSearching: true, searchQuery: filters.query ?? get().searchQuery });
    const { data, error } = await searchChannelMessages(channelId, filters);
    set({ isSearching: false });
    if (error || !data) {
      set({ searchResults: [] });
      return;
    }
    set({ searchResults: data.messages, isSearchPanelOpen: true });
  },

  closeSearchPanel: () => set({ isSearchPanelOpen: false }),

  jumpToMessage: async (messageId) => {
    set({ isSearchPanelOpen: false });

    let attempts = 0;
    while (
      !get().messages.some((m) => m.id === messageId) &&
      get().hasMoreMessages &&
      attempts < MAX_JUMP_PAGE_FETCHES
    ) {
      await get().loadOlderMessages();
      attempts += 1;
    }

    if (get().messages.some((m) => m.id === messageId)) {
      set({ highlightedMessageId: messageId });
    }
  },

  clearHighlight: () => set({ highlightedMessageId: null }),

  setOnlineUsers: (users) => {
    set({ onlineUsers: users });
    const onlineIds = new Set(users.map((u) => u.user_id));
    set((state) => {
      const next = Object.fromEntries(
        Object.entries(state.typingUsers).filter(([id]) => onlineIds.has(id))
      );
      return Object.keys(next).length === Object.keys(state.typingUsers).length
        ? state
        : { typingUsers: next };
    });
  },

  setTypingUser: (userId, username, typing) =>
    set((state) => {
      const next = { ...state.typingUsers };
      if (typing) next[userId] = username;
      else delete next[userId];
      return { typingUsers: next };
    }),

  setDraft: (value) => set({ draft: value }),

  stopTypingNow: () => {
    clearTypingTimer();
    if (isTyping) {
      isTyping = false;
      sendTyping(false);
    }
  },

  handleDraftChange: (value) => {
    set({ draft: value });

    if (!value.trim()) {
      get().stopTypingNow();
      return;
    }

    if (!isTyping) {
      isTyping = true;
      sendTyping(true);
    }

    clearTypingTimer();
    typingStopTimer = window.setTimeout(() => get().stopTypingNow(), TYPING_STOP_DELAY_MS);
  },

  sendMessage: () => {
    const content = get().draft.trim();
    if (!content) return;
    get().stopTypingNow();
    shout(content);
    set({ draft: '' });
  },

  handleFileSelected: async (file) => {
    const activeChannelId = useServerStore.getState().activeChannelId;
    if (!activeChannelId || get().isUploading) return;

    set({ isUploading: true, uploadError: '' });
    const { data, error } = await uploadFile(file);
    set({ isUploading: false });

    if (error || !data) {
      set({ uploadError: error ?? 'Yükleme başarısız oldu' });
      return;
    }

    // The upload was in flight long enough for the user to switch (or
    // leave) channels — sending now would drop the file into whatever
    // channel they've since moved to instead of the one they picked it for.
    if (useServerStore.getState().activeChannelId !== activeChannelId) {
      set({ uploadError: 'Kanal değiştirdiğiniz için yükleme iptal edildi.' });
      return;
    }

    get().stopTypingNow();
    shout(get().draft.trim(), data.file_url, data.file_type);
    set({ draft: '' });
  },

  setDraggingFile: (value) => set({ isDraggingFile: value }),
  setLightboxUrl: (url) => set({ lightboxUrl: url }),

  // No optimistic local update — same "single source of truth via the
  // broadcast" convention the rest of the store follows (see sendMessage),
  // since the server echoes "reaction_toggled" back to the sender too.
  toggleReaction: (messageId, emoji) => toggleReaction(messageId, emoji),

  handleReactionToggled: (payload) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === payload.message_id ? { ...msg, reactions: payload.reactions } : msg
      ),
    })),

  editMessage: (messageId, content) => editMessage(messageId, content),

  handleMessageUpdated: (msg) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === msg.id ? msg : m)),
    })),

  reset: () => {
    clearTypingTimer();
    isTyping = false;
    set({
      messages: [],
      draft: '',
      onlineUsers: [],
      typingUsers: {},
      isUploading: false,
      uploadError: '',
      isDraggingFile: false,
      lightboxUrl: null,
      hasMoreMessages: true,
      isLoadingOlderMessages: false,
      searchQuery: '',
      searchResults: [],
      isSearching: false,
      isSearchPanelOpen: false,
      highlightedMessageId: null,
    });
  },
}));
