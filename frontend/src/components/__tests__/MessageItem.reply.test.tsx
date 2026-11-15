import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MessageItem from '../MessageItem';
import type { ChatMessage } from '../../types';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm2',
    content: 'cevap',
    file_url: null,
    file_type: null,
    user_id: 'author',
    username: 'yazar',
    inserted_at: '2026-11-16T00:00:00Z',
    is_edited: false,
    reactions: [],
    is_deleted: false,
    ...overrides,
  };
}

function renderItem(props: Partial<Parameters<typeof MessageItem>[0]> = {}) {
  return render(
    <MessageItem
      message={makeMessage()}
      currentUserId="viewer"
      onToggleReaction={vi.fn()}
      onEditMessage={vi.fn()}
      onDeleteMessage={vi.fn()}
      onImageClick={vi.fn()}
      {...props}
    />
  );
}

afterEach(cleanup);

describe('MessageItem — yanıt', () => {
  it('"Yanıtla" in the context menu calls onReply', () => {
    const onReply = vi.fn();
    renderItem({ onReply });

    fireEvent.contextMenu(screen.getByText('cevap'));
    fireEvent.click(screen.getByText('Yanıtla'));

    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('shows what it replies to, and clicking it jumps there', () => {
    const onJumpToMessage = vi.fn();
    renderItem({
      onJumpToMessage,
      message: makeMessage({
        reply_to: {
          id: 'm1',
          user_id: 'u1',
          username: 'ilkyazan',
          content: 'ilk mesaj',
          has_file: false,
          is_deleted: false,
        },
      }),
    });

    expect(screen.getByText('@ilkyazan')).not.toBeNull();
    fireEvent.click(screen.getByText('ilk mesaj'));
    expect(onJumpToMessage).toHaveBeenCalledWith('m1');
  });

  it('says so when the original was deleted', () => {
    renderItem({
      message: makeMessage({
        reply_to: { id: 'm1', user_id: 'u1', username: 'ilkyazan', content: null, has_file: false, is_deleted: true },
      }),
    });

    expect(screen.getByText('Orijinal mesaj silindi')).not.toBeNull();
  });
});

describe('MessageItem — bahsetme', () => {
  it('highlights a message that mentions the viewer', () => {
    const { container } = renderItem({
      currentUsername: 'viewer_name',
      message: makeMessage({ content: 'selam @viewer_name nasılsın' }),
    });

    expect(container.querySelector('.message-mentioned')).not.toBeNull();
    expect(screen.getByText('@viewer_name').className).toContain('message-mention');
  });

  it('does not highlight a message mentioning someone else', () => {
    const { container } = renderItem({
      currentUsername: 'viewer_name',
      message: makeMessage({ content: 'selam @baskasi' }),
    });

    expect(container.querySelector('.message-mentioned')).toBeNull();
  });
});
