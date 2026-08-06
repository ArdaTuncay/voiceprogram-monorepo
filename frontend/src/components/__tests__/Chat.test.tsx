import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import Chat from '../Chat';
import { useServerStore } from '../../stores/useServerStore';
import { useDMStore } from '../../stores/useDMStore';
import { useChatStore } from '../../stores/useChatStore';
import { useFriendStore } from '../../stores/useFriendStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useVoiceChannel } from '../../hooks/useVoiceChannel';
import type { User, Server, Channel } from '../../types';

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

// useVoiceChannel does real WebRTC/getUserMedia work that jsdom can't
// support (see hooks/__tests__/webrtcTestUtils.ts) — mocked here so the
// screen-share tests below can drive voice.screenShares directly instead of
// actually joining a room. makeVoiceMock's defaults (no active room, no
// shares) match what the real hook returns on a fresh mount, so the
// existing tests below that never touch voice state are unaffected.
vi.mock('../../hooks/useVoiceChannel', () => ({
  useVoiceChannel: vi.fn(),
}));

function makeVoiceMock(overrides: Partial<ReturnType<typeof useVoiceChannel>> = {}): ReturnType<typeof useVoiceChannel> {
  return {
    activeRoomId: null,
    participants: [],
    speakingUserIds: new Set(),
    remoteStreams: {},
    screenShares: {},
    isScreenSharing: false,
    isMuted: false,
    isDeafened: false,
    reconnectingPeerIds: new Set(),
    error: '',
    join: vi.fn(),
    leave: vi.fn(),
    startScreenShare: vi.fn(),
    stopScreenShare: vi.fn(),
    toggleMute: vi.fn(),
    toggleDeafen: vi.fn(),
    ...overrides,
  };
}

const testUser: User = { id: 'u1', username: 'ardatuncay', email: 'arda@example.com' };

afterEach(cleanup);

beforeEach(() => {
  useServerStore.getState().reset();
  useDMStore.getState().reset();
  useChatStore.getState().reset();
  useFriendStore.getState().reset();
  useConnectionStore.getState().reset();
  vi.mocked(useVoiceChannel).mockReturnValue(makeVoiceMock());
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

const testServer: Server = { id: 'srv-1', name: 'Test Sunucu', owner_id: 'owner-1' };
const testChannel: Channel = { id: 'ch-1', name: 'genel', type: 'text', parent_id: null, position: 0 };

function setupActiveChannel(channels: Channel[] = [testChannel]) {
  useServerStore.setState({
    servers: [testServer],
    activeServerId: testServer.id,
    channels,
    activeChannelId: testChannel.id,
  });
}

describe('Chat — kanal arama çubuğu aç/kapa', () => {
  it('varsayılan olarak arama input\'u kapalı', () => {
    setupActiveChannel();
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(screen.queryByPlaceholderText('Mesajlarda ara...')).toBeNull();
  });

  it('arama ikonuna tıklayınca input açılır', () => {
    setupActiveChannel();
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Mesajlarda ara' }));

    expect(screen.getByPlaceholderText('Mesajlarda ara...')).not.toBeNull();
  });

  it('tekrar tıklayınca input kapanır ve yazılan metin sıfırlanır', () => {
    setupActiveChannel();
    render(<Chat user={testUser} onLogout={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Mesajlarda ara' });

    fireEvent.click(toggle);
    fireEvent.change(screen.getByPlaceholderText('Mesajlarda ara...'), { target: { value: 'merhaba' } });
    fireEvent.click(toggle);

    expect(screen.queryByPlaceholderText('Mesajlarda ara...')).toBeNull();

    fireEvent.click(toggle);
    expect((screen.getByPlaceholderText('Mesajlarda ara...') as HTMLInputElement).value).toBe('');
  });

  it('kanal değiştirilince arama otomatik kapanır', () => {
    const secondChannel: Channel = { id: 'ch-2', name: 'oyun', type: 'text', parent_id: null, position: 1 };
    setupActiveChannel([testChannel, secondChannel]);
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Mesajlarda ara' }));
    expect(screen.getByPlaceholderText('Mesajlarda ara...')).not.toBeNull();

    fireEvent.click(screen.getByText('oyun'));

    expect(screen.queryByPlaceholderText('Mesajlarda ara...')).toBeNull();
  });
});

describe('Chat — ekran paylaşımı büyütme overlay', () => {
  const peerId = 'u2';
  const fakeStream = {} as MediaStream;

  function setupScreenShare(screenShares: Record<string, MediaStream>) {
    setupActiveChannel();
    vi.mocked(useVoiceChannel).mockReturnValue(
      makeVoiceMock({
        screenShares,
        participants: [{ user_id: peerId, username: 'diğer-kullanıcı', online_at: 0 }],
      }),
    );
  }

  it('paylaşım yokken büyüt butonu render edilmez', () => {
    setupScreenShare({});
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(screen.queryByTitle('Büyüt')).toBeNull();
  });

  it('büyüt butonuna tıklayınca overlay açılır', () => {
    setupScreenShare({ [peerId]: fakeStream });
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Büyüt'));

    expect(screen.getByTitle('Kapat')).not.toBeNull();
  });

  it('X butonuna tıklayınca overlay kapanır', () => {
    setupScreenShare({ [peerId]: fakeStream });
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Büyüt'));
    fireEvent.click(screen.getByTitle('Kapat'));

    expect(screen.queryByTitle('Kapat')).toBeNull();
  });

  it("backdrop'a tıklayınca overlay kapanır", () => {
    setupScreenShare({ [peerId]: fakeStream });
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Büyüt'));
    fireEvent.click(screen.getByRole('presentation'));

    expect(screen.queryByTitle('Kapat')).toBeNull();
  });

  it('ESC ile overlay kapanır', () => {
    setupScreenShare({ [peerId]: fakeStream });
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Büyüt'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTitle('Kapat')).toBeNull();
  });

  it('paylaşım durunca (screenShares\'ten kalkınca) overlay otomatik kapanır', () => {
    setupScreenShare({ [peerId]: fakeStream });
    const { rerender } = render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Büyüt'));
    expect(screen.getByTitle('Kapat')).not.toBeNull();

    vi.mocked(useVoiceChannel).mockReturnValue(
      makeVoiceMock({ participants: [{ user_id: peerId, username: 'diğer-kullanıcı', online_at: 0 }] }),
    );
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(screen.queryByTitle('Kapat')).toBeNull();
  });
});
