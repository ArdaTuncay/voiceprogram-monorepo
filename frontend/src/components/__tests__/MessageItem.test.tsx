import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MessageItem from '../MessageItem';
import type { ChatMessage } from '../../types';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    content: 'merhaba',
    file_url: null,
    file_type: null,
    user_id: 'author',
    username: 'yazar',
    inserted_at: '2026-08-06T00:00:00Z',
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
      currentUserId="author"
      onToggleReaction={vi.fn()}
      onEditMessage={vi.fn()}
      onDeleteMessage={vi.fn()}
      onImageClick={vi.fn()}
      {...props}
    />
  );
}

function openContextMenu() {
  fireEvent.contextMenu(screen.getByText('merhaba'));
}

afterEach(cleanup);

describe('MessageItem', () => {
  describe('is_deleted', () => {
    it('shows the "Bu mesaj silindi" placeholder instead of content/attachment', () => {
      renderItem({
        message: makeMessage({
          is_deleted: true,
          content: null as unknown as string,
          file_url: 'http://example.com/f.png',
          file_type: 'image/png',
        }),
      });

      expect(screen.getByText('Bu mesaj silindi')).not.toBeNull();
      expect(screen.queryByRole('img', { name: 'ek' })).toBeNull();
    });

    it('does not show the "(düzenlendi)" tag on a deleted message', () => {
      renderItem({ message: makeMessage({ is_deleted: true, is_edited: true }) });

      expect(screen.queryByText('(düzenlendi)')).toBeNull();
    });

    it('never opens the context menu for a deleted message', () => {
      renderItem({ message: makeMessage({ is_deleted: true }) });

      fireEvent.contextMenu(screen.getByText('Bu mesaj silindi'));

      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  describe('context menu — opening', () => {
    it('opens on right-click at the cursor position', () => {
      renderItem();

      openContextMenu();

      const menu = screen.getByRole('menu');
      expect(menu).not.toBeNull();
    });

    it('does not open on a plain left-click', () => {
      renderItem();

      fireEvent.click(screen.getByText('merhaba'));

      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  describe('context menu — item visibility', () => {
    it('shows "Düzenle" and "Sil" for the message author', () => {
      renderItem({ message: makeMessage({ user_id: 'author' }), currentUserId: 'author' });

      openContextMenu();

      expect(screen.getByText('Düzenle')).not.toBeNull();
      expect(screen.getByText('Sil')).not.toBeNull();
      expect(screen.getByText('İfade Bırak')).not.toBeNull();
    });

    it('hides "Düzenle" and "Sil" for a plain member who neither wrote it nor owns the server', () => {
      renderItem({
        message: makeMessage({ user_id: 'someone-else' }),
        currentUserId: 'viewer',
        isServerOwner: false,
      });

      openContextMenu();

      expect(screen.queryByText('Düzenle')).toBeNull();
      expect(screen.queryByText('Sil')).toBeNull();
      expect(screen.getByText('İfade Bırak')).not.toBeNull();
    });

    it('shows "Sil" (but not "Düzenle") for the server owner on someone else\'s message', () => {
      renderItem({
        message: makeMessage({ user_id: 'someone-else' }),
        currentUserId: 'owner',
        isServerOwner: true,
      });

      openContextMenu();

      expect(screen.queryByText('Düzenle')).toBeNull();
      expect(screen.getByText('Sil')).not.toBeNull();
    });

    it('is author-only in a DM — isServerOwner is never passed there', () => {
      renderItem({ message: makeMessage({ user_id: 'someone-else' }), currentUserId: 'viewer' });

      openContextMenu();

      expect(screen.queryByText('Sil')).toBeNull();
    });
  });

  describe('context menu — actions', () => {
    it('"Düzenle" switches the message into edit mode', () => {
      renderItem();

      openContextMenu();
      fireEvent.click(screen.getByText('Düzenle'));

      expect(screen.queryByRole('menu')).toBeNull();
      expect(screen.getByDisplayValue('merhaba')).not.toBeNull();
    });

    it('"Sil" runs the same confirm-then-delete flow as before, and closes the menu', () => {
      const onDeleteMessage = vi.fn();
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      renderItem({ onDeleteMessage });

      openContextMenu();
      fireEvent.click(screen.getByText('Sil'));

      expect(window.confirm).toHaveBeenCalledTimes(1);
      expect(onDeleteMessage).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('menu')).toBeNull();

      vi.unstubAllGlobals();
    });

    it('"Sil" does not delete when the confirm is cancelled', () => {
      const onDeleteMessage = vi.fn();
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
      renderItem({ onDeleteMessage });

      openContextMenu();
      fireEvent.click(screen.getByText('Sil'));

      expect(onDeleteMessage).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('"İfade Bırak" force-opens the reaction picker (without touching the hover mechanism)', () => {
      const { container } = renderItem();

      openContextMenu();
      fireEvent.click(screen.getByText('İfade Bırak'));

      expect(container.querySelector('.message.reaction-picker-open')).not.toBeNull();
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  describe('reaction picker — forced-open only, not hover', () => {
    it('is not force-open on initial render', () => {
      const { container } = renderItem();

      expect(container.querySelector('.message.reaction-picker-open')).toBeNull();
    });

    it('does NOT close when the mouse leaves .message — only leaving the picker itself should', () => {
      // Regression test: MessageContextMenu is a `position: fixed` overlay,
      // so moving the cursor onto it (to click "İfade Bırak" in the first
      // place) already fires a real mouseleave on `.message` as the menu
      // closes — that used to immediately re-close the picker it had just
      // opened, in the same instant.
      const { container } = renderItem();

      openContextMenu();
      fireEvent.click(screen.getByText('İfade Bırak'));
      expect(container.querySelector('.message.reaction-picker-open')).not.toBeNull();

      fireEvent.mouseLeave(container.querySelector('.message')!);

      expect(container.querySelector('.message.reaction-picker-open')).not.toBeNull();
    });

    it('closes once the mouse leaves the picker itself', () => {
      const { container } = renderItem();

      openContextMenu();
      fireEvent.click(screen.getByText('İfade Bırak'));
      expect(container.querySelector('.message.reaction-picker-open')).not.toBeNull();

      fireEvent.mouseLeave(container.querySelector('.message-reaction-picker')!);

      expect(container.querySelector('.message.reaction-picker-open')).toBeNull();
    });
  });

  describe('context menu — closing', () => {
    it('closes on Escape', () => {
      renderItem();

      openContextMenu();
      expect(screen.getByRole('menu')).not.toBeNull();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('closes when clicking the backdrop outside the menu', () => {
      renderItem();

      openContextMenu();
      expect(screen.getByRole('menu')).not.toBeNull();

      fireEvent.click(screen.getByRole('presentation'));

      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  describe('isGrouped', () => {
    it('renders the avatar/author/timestamp header when not grouped', () => {
      const { container } = renderItem({ isGrouped: false });

      expect(container.querySelector('.message-avatar')).not.toBeNull();
      expect(screen.getByText('yazar')).not.toBeNull();
      expect(container.querySelector('.message-content-grouped')).toBeNull();
    });

    it('suppresses the avatar/author/timestamp header when grouped, but still shows the content', () => {
      const { container } = renderItem({ isGrouped: true });

      expect(container.querySelector('.message-avatar')).toBeNull();
      expect(screen.queryByText('yazar')).toBeNull();
      expect(screen.getByText('merhaba')).not.toBeNull();
      expect(container.querySelector('.message-content-grouped')).not.toBeNull();
    });

    it('does not show the "(düzenlendi)" tag when grouped, since the whole header is suppressed', () => {
      renderItem({ isGrouped: true, message: makeMessage({ is_edited: true }) });

      expect(screen.queryByText('(düzenlendi)')).toBeNull();
    });

    it('still shows the deleted placeholder when grouped — no special case for it', () => {
      const { container } = renderItem({
        isGrouped: true,
        message: makeMessage({ is_deleted: true }),
      });

      expect(screen.getByText('Bu mesaj silindi')).not.toBeNull();
      expect(container.querySelector('.message-avatar')).toBeNull();
      expect(container.querySelector('.message-content-grouped')).not.toBeNull();
    });

    it('still opens the context menu on right-click when grouped', () => {
      renderItem({ isGrouped: true });

      fireEvent.contextMenu(screen.getByText('merhaba'));

      expect(screen.getByRole('menu')).not.toBeNull();
    });
  });
});
