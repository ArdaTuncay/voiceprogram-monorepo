import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '../useChatStore';
import { useServerStore } from '../useServerStore';
import type { ChatMessage } from '../../types';

vi.mock('../../services/socket', () => ({
  shout: vi.fn(),
  sendTyping: vi.fn(),
  toggleReaction: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  fetchChannelMessages: vi.fn(),
  uploadFile: vi.fn(),
}));

import { shout } from '../../services/socket';
import { uploadFile } from '../../services/api';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    content: 'hello',
    file_url: null,
    file_type: null,
    user_id: 'u1',
    username: 'ardatuncay',
    inserted_at: '2026-07-14T00:00:00Z',
    is_edited: false,
    reactions: [],
    ...overrides,
  };
}

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useServerStore.getState().reset();
    vi.clearAllMocks();
  });

  it('reset() restores every field to its initial value after heavy mutation', () => {
    useChatStore.setState({
      messages: [makeMessage()],
      draft: 'unsent draft',
      onlineUsers: [{ user_id: 'u1', username: 'ardatuncay', online_at: 1752451200 }],
      typingUsers: { u1: 'ardatuncay' },
      isUploading: true,
      uploadError: 'something broke',
      isDraggingFile: true,
      lightboxUrl: 'https://example.com/image.png',
      hasMoreMessages: false,
      isLoadingOlderMessages: true,
    });

    useChatStore.getState().reset();

    expect(useChatStore.getState()).toMatchObject({
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
    });
  });

  it('sendMessage sends the trimmed draft and clears it', () => {
    useChatStore.getState().setDraft('  hello world  ');

    useChatStore.getState().sendMessage();

    expect(shout).toHaveBeenCalledWith('hello world');
    expect(useChatStore.getState().draft).toBe('');
  });

  it('sendMessage is a no-op for an empty/whitespace-only draft', () => {
    useChatStore.getState().setDraft('   ');

    useChatStore.getState().sendMessage();

    expect(shout).not.toHaveBeenCalled();
  });

  it('handleReactionToggled only updates the matching message', () => {
    useChatStore.setState({
      messages: [makeMessage({ id: 'a', reactions: [] }), makeMessage({ id: 'b', reactions: [] })],
    });

    useChatStore.getState().handleReactionToggled({
      message_id: 'a',
      reactions: [{ emoji: '👍', count: 1, user_ids: ['u1'] }],
    });

    const [a, b] = useChatStore.getState().messages;
    expect(a.reactions).toEqual([{ emoji: '👍', count: 1, user_ids: ['u1'] }]);
    expect(b.reactions).toEqual([]);
  });

  it('handleFileSelected discards the upload if the active channel changed while it was in flight', async () => {
    useServerStore.setState({ activeChannelId: 'channel-1' });

    let resolveUpload!: (value: { data: { file_url: string; file_type: string } }) => void;
    vi.mocked(uploadFile).mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      })
    );

    const pending = useChatStore
      .getState()
      .handleFileSelected(new File(['x'], 'x.png', { type: 'image/png' }));

    // The user switches channels while the upload is still in flight.
    useServerStore.setState({ activeChannelId: 'channel-2' });
    resolveUpload({ data: { file_url: '/uploads/x.png', file_type: 'image/png' } });
    await pending;

    expect(shout).not.toHaveBeenCalled();
    expect(useChatStore.getState().uploadError).toBe('Kanal değiştirdiğiniz için yükleme iptal edildi.');
  });

  it('handleFileSelected sends the message when the active channel is unchanged', async () => {
    useServerStore.setState({ activeChannelId: 'channel-1' });
    vi.mocked(uploadFile).mockResolvedValue({
      data: { file_url: '/uploads/x.png', file_type: 'image/png' },
    });

    await useChatStore.getState().handleFileSelected(new File(['x'], 'x.png', { type: 'image/png' }));

    expect(shout).toHaveBeenCalledWith('', '/uploads/x.png', 'image/png');
    expect(useChatStore.getState().uploadError).toBe('');
  });
});
