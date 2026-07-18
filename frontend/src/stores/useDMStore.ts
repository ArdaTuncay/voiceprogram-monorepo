import { create } from 'zustand';
import type {
  ChatMessage,
  DmRoom,
  NewDmMessageNotification,
  ReactionToggledPayload,
  SearchFilters,
} from '../types';
import { fetchDmRooms, fetchDmRoomMessages, openDmRoom, searchDmMessages, uploadFile } from '../services/api';
import { sendDmMessage, sendDmTyping, toggleDmReaction, editDmMessage } from '../services/socket';

// Safety cap on how many older pages jumpToMessage will fetch while hunting
// for a search result that isn't in the currently loaded window, so a
// message from very early room history can't spin the loop forever.
const MAX_JUMP_PAGE_FETCHES = 20;

// The room-join socket response and the REST pagination endpoint both cap a
// page at this many messages — used here to infer `hasMoreMessages` from a
// page that came back short.
const MESSAGE_PAGE_SIZE = 50;

// How long to wait after the last keystroke before telling the room the
// user stopped typing — same debounce shape as useChatStore's channel typing.
const TYPING_STOP_DELAY_MS = 2000;
let isTyping = false;
let typingStopTimer: number | null = null;

function clearTypingTimer() {
  if (typingStopTimer !== null) {
    window.clearTimeout(typingStopTimer);
    typingStopTimer = null;
  }
}

interface DMStoreState {
  rooms: DmRoom[];
  activeRoomId: string | null;
  unreadRoomIds: Set<string>;
  roomsError: string;

  messages: ChatMessage[];
  draft: string;
  /** A DM room only ever has one other participant, so a single flag (their
   * username, or null) is enough — no need for the map useChatStore's
   * per-channel typing indicator uses. */
  typingUsername: string | null;
  isUploading: boolean;
  uploadError: string;
  isDraggingFile: boolean;
  lightboxUrl: string | null;
  /** Whether an older page of history is known to exist for the active
   * room — false once a fetch comes back short of a full page. */
  hasMoreMessages: boolean;
  isLoadingOlderMessages: boolean;

  /** Search-panel state — driven by the DM header's search bar. */
  searchQuery: string;
  searchResults: ChatMessage[];
  isSearching: boolean;
  isSearchPanelOpen: boolean;
  /** The message id to flash-highlight in the message list, set by
   * `jumpToMessage` once the target message is confirmed loaded. */
  highlightedMessageId: string | null;

  loadRooms: () => Promise<void>;
  openRoomWithUser: (userId: string) => Promise<string | undefined>;
  setActiveRoomId: (roomId: string | null) => void;
  markUnread: (roomId: string) => void;
  markRead: (roomId: string) => void;

  resetForRoomSwitch: () => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
  /** Fetches the 50 messages older than the current oldest loaded message
   * and prepends them — the infinite-scroll-upward action. No-op if a fetch
   * is already in flight, there's no active room, or the last fetch
   * indicated no older history remains. */
  loadOlderMessages: () => Promise<void>;
  setTyping: (username: string | null) => void;

  setSearchQuery: (query: string) => void;
  /** Runs a search against the active room and opens the results panel. */
  searchDmMessages: (roomId: string, filters: SearchFilters) => Promise<void>;
  closeSearchPanel: () => void;
  /** Brings `messageId` into the loaded `messages` window (fetching older
   * pages if needed, up to a safety cap) and flash-highlights it — the
   * "jump to this message" action from a search result. Closes the search
   * panel regardless of whether the message was ultimately found. */
  jumpToMessage: (messageId: string) => Promise<void>;
  clearHighlight: () => void;

  handleDraftChange: (value: string) => void;
  stopTypingNow: () => void;
  sendMessage: () => void;
  handleFileSelected: (file: File) => Promise<void>;
  setDraggingFile: (value: boolean) => void;
  setLightboxUrl: (url: string | null) => void;

  toggleReaction: (messageId: string, emoji: string) => void;
  // Reducer driven by the room's "reaction_toggled" socket event — see
  // stores/useSocketStore.ts.
  handleReactionToggled: (payload: ReactionToggledPayload) => void;

  editMessage: (messageId: string, content: string) => void;
  // Reducer driven by the room's "dm_message_updated" socket event — see
  // stores/useSocketStore.ts. Replaces the message by id in place, same
  // convention as handleReactionToggled.
  handleMessageUpdated: (msg: ChatMessage) => void;

  // Reducer driven by the personal "user:<id>" socket topic — see
  // stores/useSocketStore.ts, which wires this to the actual event.
  handleNewDmMessage: (payload: NewDmMessageNotification) => void;

  /** Wipes this store back to its initial state — called on a forced logout
   * (see services/session.ts) so nothing from this session leaks into
   * whatever comes next in the same tab (a fresh login, or a different
   * account entirely). */
  reset: () => void;
}

export const useDMStore = create<DMStoreState>((set, get) => ({
  rooms: [],
  activeRoomId: null,
  unreadRoomIds: new Set(),
  roomsError: '',

  messages: [],
  draft: '',
  typingUsername: null,
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

  loadRooms: async () => {
    const { data, error } = await fetchDmRooms();
    if (error || !data) {
      set({ roomsError: error ?? 'Sohbetler alınamadı' });
      return;
    }
    set({ rooms: data, roomsError: '' });
  },

  openRoomWithUser: async (userId) => {
    const { data, error } = await openDmRoom(userId);
    if (error || !data) return error ?? 'Sohbet açılamadı';

    set((state) => (state.rooms.some((r) => r.id === data.id) ? state : { rooms: [...state.rooms, data] }));
    get().setActiveRoomId(data.id);
    return undefined;
  },

  setActiveRoomId: (roomId) => {
    if (roomId) get().markRead(roomId);
    set({ activeRoomId: roomId });
  },

  markUnread: (roomId) =>
    set((state) => ({ unreadRoomIds: new Set(state.unreadRoomIds).add(roomId) })),

  markRead: (roomId) =>
    set((state) => {
      if (!state.unreadRoomIds.has(roomId)) return state;
      const next = new Set(state.unreadRoomIds);
      next.delete(roomId);
      return { unreadRoomIds: next };
    }),

  resetForRoomSwitch: () => {
    clearTypingTimer();
    isTyping = false;
    set({
      messages: [],
      typingUsername: null,
      hasMoreMessages: true,
      isLoadingOlderMessages: false,
      searchQuery: '',
      searchResults: [],
      isSearching: false,
      isSearchPanelOpen: false,
      highlightedMessageId: null,
    });
  },

  setMessages: (messages) => set({ messages, hasMoreMessages: messages.length >= MESSAGE_PAGE_SIZE }),
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

  loadOlderMessages: async () => {
    const state = get();
    if (state.isLoadingOlderMessages || !state.hasMoreMessages || state.messages.length === 0) return;

    const roomId = state.activeRoomId;
    if (!roomId) return;

    const oldestId = state.messages[0].id;
    set({ isLoadingOlderMessages: true });
    const { data, error } = await fetchDmRoomMessages(roomId, oldestId);
    set({ isLoadingOlderMessages: false });
    if (error || !data) return;

    // The active room may have changed while the fetch was in flight —
    // don't splice an older page from room A onto room B's history.
    if (get().activeRoomId !== roomId) return;

    set((s) => ({
      messages: [...data.messages, ...s.messages],
      hasMoreMessages: data.has_more,
    }));
  },

  setTyping: (username) => set({ typingUsername: username }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  searchDmMessages: async (roomId, filters) => {
    set({ isSearching: true, searchQuery: filters.query ?? get().searchQuery });
    const { data, error } = await searchDmMessages(roomId, filters);
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

  stopTypingNow: () => {
    clearTypingTimer();
    if (isTyping) {
      isTyping = false;
      sendDmTyping(false);
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
      sendDmTyping(true);
    }

    clearTypingTimer();
    typingStopTimer = window.setTimeout(() => get().stopTypingNow(), TYPING_STOP_DELAY_MS);
  },

  sendMessage: () => {
    const content = get().draft.trim();
    if (!content) return;
    get().stopTypingNow();
    sendDmMessage(content);
    set({ draft: '' });
  },

  handleFileSelected: async (file) => {
    const activeRoomId = get().activeRoomId;
    if (!activeRoomId || get().isUploading) return;

    set({ isUploading: true, uploadError: '' });
    const { data, error } = await uploadFile(file);
    set({ isUploading: false });

    if (error || !data) {
      set({ uploadError: error ?? 'Yükleme başarısız oldu' });
      return;
    }

    // The upload was in flight long enough for the user to switch (or
    // leave) rooms — sending now would drop the file into whatever room
    // they've since moved to instead of the one they picked it for.
    if (get().activeRoomId !== activeRoomId) {
      set({ uploadError: 'Kanal değiştirdiğiniz için yükleme iptal edildi.' });
      return;
    }

    get().stopTypingNow();
    sendDmMessage(get().draft.trim(), data.file_url, data.file_type);
    set({ draft: '' });
  },

  setDraggingFile: (value) => set({ isDraggingFile: value }),
  setLightboxUrl: (url) => set({ lightboxUrl: url }),

  // No optimistic local update — the server echoes "reaction_toggled" back
  // to the sender too, same convention as useChatStore.toggleReaction.
  toggleReaction: (messageId, emoji) => toggleDmReaction(messageId, emoji),

  handleReactionToggled: (payload) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === payload.message_id ? { ...msg, reactions: payload.reactions } : msg
      ),
    })),

  editMessage: (messageId, content) => editDmMessage(messageId, content),

  handleMessageUpdated: (msg) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === msg.id ? msg : m)),
    })),

  handleNewDmMessage: (payload) => {
    if (payload.dm_room_id === get().activeRoomId) return;

    get().markUnread(payload.dm_room_id);
    if (!get().rooms.some((r) => r.id === payload.dm_room_id)) {
      // First message in a room we don't have cached yet (e.g. someone just
      // opened a DM with us) — refetch to pick it up rather than trying to
      // reconstruct a DmRoom view from a chat-message-shaped payload.
      void get().loadRooms();
    }
  },

  reset: () => {
    clearTypingTimer();
    isTyping = false;
    set({
      rooms: [],
      activeRoomId: null,
      unreadRoomIds: new Set(),
      roomsError: '',
      messages: [],
      draft: '',
      typingUsername: null,
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
