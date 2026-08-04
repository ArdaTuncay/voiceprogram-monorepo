import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import Chat from '../Chat';
import { useServerStore } from '../../stores/useServerStore';
import { useDMStore } from '../../stores/useDMStore';
import { useChatStore } from '../../stores/useChatStore';
import { useFriendStore } from '../../stores/useFriendStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import type { User } from '../../types';

vi.mock('../../services/api', () => ({
  fetchServers: vi.fn().mockResolvedValue({ data: [] }),
  fetchDmRooms: vi.fn().mockResolvedValue({ data: [] }),
  fetchFriends: vi.fn().mockResolvedValue({ data: [] }),
  fetchServerChannels: vi.fn().mockResolvedValue({ data: [] }),
  fetchServerMembers: vi.fn().mockResolvedValue({ data: [] }),
  fetchTurnCredentials: vi.fn().mockResolvedValue({ data: { ice_servers: [] } }),
}));

vi.mock('../../services/socket', () => ({
  joinChatChannel: vi.fn().mockReturnValue(() => {}),
  joinDmChannel: vi.fn().mockReturnValue(() => {}),
  joinUserChannel: vi.fn().mockReturnValue(() => {}),
  joinServerChannel: vi.fn().mockReturnValue(() => {}),
  joinVoiceChannel: vi.fn(),
  sendVoiceOffer: vi.fn(),
  sendVoiceAnswer: vi.fn(),
  sendIceCandidate: vi.fn(),
  sendVoiceStatus: vi.fn(),
  sendIceDiagnostics: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const testUser: User = { id: 'u1', username: 'ardatuncay', email: 'arda@example.com' };

afterEach(cleanup);

beforeEach(() => {
  useServerStore.getState().reset();
  useDMStore.getState().reset();
  useChatStore.getState().reset();
  useFriendStore.getState().reset();
  useConnectionStore.getState().reset();
});

describe('Chat — Home ekranı ve Arkadaşlar ayrımı', () => {
  it('shows the shared empty state (mascot) by default, not the Friends panel', () => {
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(screen.getByText('Sohbet etmeye başlamak için bir kişi veya kanal seç')).not.toBeNull();
    expect(screen.queryByText('Arkadaş Ekle')).toBeNull();
    expect(screen.queryByText('Bekleyen İstekler')).toBeNull();
  });

  it('opens the Friends management screen in its own view when the Arkadaşlar icon is clicked', () => {
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Arkadaşlar' }));

    expect(screen.getByText('Arkadaş Ekle')).not.toBeNull();
    expect(screen.getByText('Bekleyen İstekler')).not.toBeNull();
    expect(screen.queryByText('Sohbet etmeye başlamak için bir kişi veya kanal seç')).toBeNull();
  });

  it('returns to the empty state (not Friends) when Home is clicked again', () => {
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Arkadaşlar' }));
    expect(screen.getByText('Arkadaş Ekle')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Direkt Mesajlar' }));

    expect(screen.queryByText('Arkadaş Ekle')).toBeNull();
    expect(screen.getByText('Sohbet etmeye başlamak için bir kişi veya kanal seç')).not.toBeNull();
  });
});
