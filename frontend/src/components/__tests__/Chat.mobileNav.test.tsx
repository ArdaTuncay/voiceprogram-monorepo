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
    peerVolumes: {},
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
    setPeerVolume: vi.fn(),
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

// Phone-width drawer (see the @media block in Chat.css). jsdom doesn't
// apply media queries, so this checks the state the CSS keys off: the
// layout's mobile-nav-open class.
describe('Chat — telefon menüsü (çekmece)', () => {
  const server: Server = { id: 'srv-m', name: 'Mobil', owner_id: 'owner-1' };
  const genel: Channel = { id: 'ch-genel', name: 'genel', type: 'text', parent_id: null, position: 0 };
  const duyuru: Channel = { id: 'ch-duyuru', name: 'duyuru', type: 'text', parent_id: null, position: 1 };

  function layout() {
    return document.querySelector('.chat-layout')!;
  }

  it('opens from the menu button and closes when a channel is tapped — even the one already open', () => {
    useServerStore.setState({
      servers: [server],
      activeServerId: server.id,
      channels: [genel, duyuru],
      channelsServerId: server.id,
      activeChannelId: genel.id,
    });
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(layout().classList.contains('mobile-nav-open')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Sunucuları ve kanalları göster' }));
    expect(layout().classList.contains('mobile-nav-open')).toBe(true);

    fireEvent.click(screen.getAllByText('genel')[0]);
    expect(layout().classList.contains('mobile-nav-open')).toBe(false);
  });

  it('closes when the backdrop is tapped', () => {
    useServerStore.setState({ servers: [server], activeServerId: server.id, channels: [genel], channelsServerId: server.id });
    render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sunucuları ve kanalları göster' }));
    fireEvent.click(document.querySelector('.mobile-nav-backdrop')!);

    expect(layout().classList.contains('mobile-nav-open')).toBe(false);
  });
});
