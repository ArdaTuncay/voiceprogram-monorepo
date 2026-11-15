import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { useChatStore } from '../useChatStore';
import { useServerStore } from '../useServerStore';
import type { ChatMessage } from '../../types';

vi.mock('../../services/socket', () => ({
  shout: vi.fn(),
  sendTyping: vi.fn(),
  toggleReaction: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  fetchChannelMessages: vi.fn(),
  uploadFile: vi.fn(),
}));

import { shout, deleteMessage, editMessage, toggleReaction } from '../../services/socket';
import type { PushFailureHandler } from '../../services/socket';
import { uploadFile } from '../../services/api';
import { chatActionErrorMessage } from '../../utils/errorMessages';

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
    is_deleted: false,
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
      actionError: 'something else broke',
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
      actionError: '',
      isDraggingFile: false,
      lightboxUrl: null,
      hasMoreMessages: true,
      isLoadingOlderMessages: false,
    });
  });

  it('sendMessage sends the trimmed draft and clears it', () => {
    useChatStore.getState().setDraft('  hello world  ');

    useChatStore.getState().sendMessage();

    expect(shout).toHaveBeenCalledWith('hello world', undefined, undefined, expect.any(Function));
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

  it('deleteMessage pushes to the socket (fire-and-forget, no local state change)', () => {
    useChatStore.getState().deleteMessage('a');

    expect(deleteMessage).toHaveBeenCalledWith('a', expect.any(Function));
  });

  it('handleMessageDeleted replaces only the matching message with the broadcasted (wiped) version', () => {
    useChatStore.setState({
      messages: [makeMessage({ id: 'a', content: 'oops' }), makeMessage({ id: 'b', content: 'still here' })],
    });

    useChatStore.getState().handleMessageDeleted(
      makeMessage({ id: 'a', content: null as unknown as string, file_url: null, file_type: null, is_deleted: true })
    );

    const [a, b] = useChatStore.getState().messages;
    expect(a.is_deleted).toBe(true);
    expect(a.content).toBeNull();
    expect(b.content).toBe('still here');
    expect(b.is_deleted).toBe(false);
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

    expect(shout).toHaveBeenCalledWith('', '/uploads/x.png', 'image/png', expect.any(Function));
    expect(useChatStore.getState().uploadError).toBe('');
  });
});

// PROJECT_ARCHITECTURE.md §7 #11 — a failed push is feedback only: the
// message list is never touched, and only a definite rejection (never a
// timeout) puts the text back in the composer.
describe('useChatStore — failed push feedback', () => {
  /** The `onFailure` the store handed to the most recent call of a
   * (mocked) socket push — always its last argument. */
  function lastFailureHandler(push: unknown): PushFailureHandler {
    const call = (push as Mock).mock.calls.at(-1);
    if (!call) throw new Error('push was never called');
    return call.at(-1) as PushFailureHandler;
  }

  beforeEach(() => {
    useChatStore.getState().reset();
    useServerStore.getState().reset();
    useServerStore.setState({ activeChannelId: 'channel-1' });
    vi.clearAllMocks();
  });

  it('a rejected send shows feedback and puts the text back, without touching messages', () => {
    const messages = [makeMessage({ id: 'a' })];
    useChatStore.setState({ messages });
    useChatStore.getState().setDraft('hello');

    useChatStore.getState().sendMessage();
    expect(useChatStore.getState().draft).toBe('');

    lastFailureHandler(shout)({ kind: 'error', reason: 'rate_limited' });

    const state = useChatStore.getState();
    expect(state.actionError).toBe(
      chatActionErrorMessage('send', { kind: 'error', reason: 'rate_limited' })
    );
    expect(state.draft).toBe('hello');
    expect(state.messages).toBe(messages);
  });

  it('a rejected send never overwrites text the user has already started typing', () => {
    useChatStore.getState().setDraft('first');
    useChatStore.getState().sendMessage();
    useChatStore.getState().setDraft('second, still being typed');

    lastFailureHandler(shout)({ kind: 'error', reason: 'rate_limited' });

    expect(useChatStore.getState().draft).toBe('second, still being typed');
    expect(useChatStore.getState().actionError).not.toBe('');
  });

  it('a timed-out send shows the neutral message and does NOT restore the text (it may still arrive)', () => {
    useChatStore.getState().setDraft('hello');
    useChatStore.getState().sendMessage();

    lastFailureHandler(shout)({ kind: 'timeout' });

    expect(useChatStore.getState().actionError).toBe(
      chatActionErrorMessage('send', { kind: 'timeout' })
    );
    expect(useChatStore.getState().draft).toBe('');
  });

  it('drops feedback for a push made in a channel the user has since left', () => {
    useChatStore.getState().setDraft('hello');
    useChatStore.getState().sendMessage();
    useServerStore.setState({ activeChannelId: 'channel-2' });

    lastFailureHandler(shout)({ kind: 'error', reason: 'rate_limited' });

    expect(useChatStore.getState().actionError).toBe('');
    expect(useChatStore.getState().draft).toBe('');
  });

  it('sending again clears the previous feedback', () => {
    useChatStore.setState({ actionError: 'old feedback' });
    useChatStore.getState().setDraft('hello');

    useChatStore.getState().sendMessage();

    expect(useChatStore.getState().actionError).toBe('');
  });

  it('resetForChannelSwitch clears the feedback', () => {
    useChatStore.setState({ actionError: 'old feedback' });

    useChatStore.getState().resetForChannelSwitch();

    expect(useChatStore.getState().actionError).toBe('');
  });

  it.each([
    ['edit', editMessage, () => useChatStore.getState().editMessage('a', 'changed')],
    ['delete', deleteMessage, () => useChatStore.getState().deleteMessage('a')],
    ['react', toggleReaction, () => useChatStore.getState().toggleReaction('a', '👍')],
  ] as const)('a rejected %s shows feedback and leaves messages untouched', (action, push, run) => {
    const messages = [makeMessage({ id: 'a', content: 'original' })];
    useChatStore.setState({ messages });

    run();
    lastFailureHandler(push)({ kind: 'error', reason: 'rate_limited' });

    expect(useChatStore.getState().actionError).toBe(
      chatActionErrorMessage(action, { kind: 'error', reason: 'rate_limited' })
    );
    expect(useChatStore.getState().messages).toBe(messages);
    expect(useChatStore.getState().draft).toBe('');
  });

  it('a rejected file send restores only its text', async () => {
    vi.mocked(uploadFile).mockResolvedValue({
      data: { file_url: '/uploads/x.png', file_type: 'image/png' },
    });
    useChatStore.getState().setDraft('caption');

    await useChatStore.getState().handleFileSelected(new File(['x'], 'x.png', { type: 'image/png' }));
    expect(useChatStore.getState().draft).toBe('');

    lastFailureHandler(shout)({ kind: 'error', reason: 'rate_limited' });

    expect(useChatStore.getState().draft).toBe('caption');
    expect(useChatStore.getState().actionError).not.toBe('');
  });
});
