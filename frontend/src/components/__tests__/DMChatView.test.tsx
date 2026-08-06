import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import DMChatView from '../DMChatView';
import { useDMStore } from '../../stores/useDMStore';
import { useFriendStore } from '../../stores/useFriendStore';
import type { DmRoom } from '../../types';

const room: DmRoom = { id: 'room-1', user_id: 'u2', username: 'diğer-kullanıcı', user_status: 'online', unread_count: 0 };

afterEach(cleanup);

beforeEach(() => {
  useDMStore.getState().reset();
  useFriendStore.getState().reset();
  useDMStore.setState({ rooms: [room], activeRoomId: room.id });
});

describe('DMChatView — arama çubuğu aç/kapa', () => {
  it('varsayılan olarak arama input\'u kapalı', () => {
    render(<DMChatView currentUserId="u1" />);

    expect(screen.queryByPlaceholderText('Mesajlarda ara...')).toBeNull();
  });

  it('arama ikonuna tıklayınca input açılır', () => {
    render(<DMChatView currentUserId="u1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Mesajlarda ara' }));

    expect(screen.getByPlaceholderText('Mesajlarda ara...')).not.toBeNull();
  });

  it('tekrar tıklayınca input kapanır ve yazılan metin sıfırlanır', () => {
    render(<DMChatView currentUserId="u1" />);
    const toggle = screen.getByRole('button', { name: 'Mesajlarda ara' });

    fireEvent.click(toggle);
    fireEvent.change(screen.getByPlaceholderText('Mesajlarda ara...'), { target: { value: 'merhaba' } });
    fireEvent.click(toggle);

    expect(screen.queryByPlaceholderText('Mesajlarda ara...')).toBeNull();

    fireEvent.click(toggle);
    expect((screen.getByPlaceholderText('Mesajlarda ara...') as HTMLInputElement).value).toBe('');
  });

  it('farklı bir DM odasına geçilince arama otomatik kapanır', () => {
    const otherRoom: DmRoom = { id: 'room-2', user_id: 'u3', username: 'başka-kullanıcı', user_status: 'offline', unread_count: 0 };
    useDMStore.setState({ rooms: [room, otherRoom], activeRoomId: room.id });
    const { rerender } = render(<DMChatView currentUserId="u1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Mesajlarda ara' }));
    expect(screen.getByPlaceholderText('Mesajlarda ara...')).not.toBeNull();

    useDMStore.setState({ activeRoomId: otherRoom.id });
    rerender(<DMChatView currentUserId="u1" />);

    expect(screen.queryByPlaceholderText('Mesajlarda ara...')).toBeNull();
  });
});
