import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
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
  joinWatchParty: vi.fn().mockReturnValue({ request: vi.fn(() => new Promise(() => {})), leave: vi.fn() }),
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
    joiningRoomId: null,
    micBlocked: false,
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

describe('Chat — kişi bazlı ses seviyesi', () => {
  const peerId = 'u2';
  const fakeStream = {} as MediaStream;

  it("audio elementine peerVolumes'taki kayıtlı değer volume olarak uygulanır", () => {
    vi.mocked(useVoiceChannel).mockReturnValue(
      makeVoiceMock({ remoteStreams: { [peerId]: fakeStream }, peerVolumes: { [peerId]: 0.4 } }),
    );
    const { container } = render(<Chat user={testUser} onLogout={vi.fn()} />);

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(audio!.volume).toBeCloseTo(0.4);
  });

  it("peerVolumes'ta bu peer için kayıt yoksa varsayılan ses seviyesi (1) uygulanır", () => {
    vi.mocked(useVoiceChannel).mockReturnValue(
      makeVoiceMock({ remoteStreams: { [peerId]: fakeStream }, peerVolumes: {} }),
    );
    const { container } = render(<Chat user={testUser} onLogout={vi.fn()} />);

    const audio = container.querySelector('audio');
    expect(audio!.volume).toBe(1);
  });
});

describe('Chat — ses bağlantısı sunucu değişince kesilmiyor, kanal gerçekten silinince kesiliyor', () => {
  const serverA: Server = { id: 'srv-a', name: 'Sunucu A', owner_id: 'owner-1' };
  const serverB: Server = { id: 'srv-b', name: 'Sunucu B', owner_id: 'owner-1' };
  const voiceChannelA: Channel = { id: 'vc-a', name: 'ses-a', type: 'voice', parent_id: null, position: 0 };
  const textChannelB: Channel = { id: 'ch-b', name: 'genel-b', type: 'text', parent_id: null, position: 0 };

  it('switching to a different server while in a voice room does not hang up the call', () => {
    useServerStore.setState({
      servers: [serverA, serverB],
      activeServerId: serverA.id,
      channels: [voiceChannelA],
      channelsServerId: serverA.id,
    });
    const { rerender } = render(<Chat user={testUser} onLogout={vi.fn()} />);

    // Joins vc-a — handleVoiceRoomClick's "else" branch captures
    // voiceRoomServerId = serverA.id internally before this rerender.
    fireEvent.click(screen.getByText('ses-a'));

    const joinedVoiceMock = makeVoiceMock({ activeRoomId: voiceChannelA.id });
    vi.mocked(useVoiceChannel).mockReturnValue(joinedVoiceMock);
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    // Switching to server B replaces `channels` wholesale with server B's
    // list (channelsServerId caught up too, as if its fetch already
    // resolved) — vc-a is no longer in it, but we're not viewing server A
    // anymore either, which is exactly what the activeServerId ===
    // voiceRoomServerId guard is for.
    useServerStore.setState({
      activeServerId: serverB.id,
      channels: [textChannelB],
      channelsServerId: serverB.id,
    });
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(joinedVoiceMock.leave).not.toHaveBeenCalled();
  });

  it('the voice channel actually being removed from the SAME server still hangs up the call', () => {
    useServerStore.setState({
      servers: [serverA],
      activeServerId: serverA.id,
      channels: [voiceChannelA],
      channelsServerId: serverA.id,
    });
    const { rerender } = render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByText('ses-a'));

    const joinedVoiceMock = makeVoiceMock({ activeRoomId: voiceChannelA.id });
    vi.mocked(useVoiceChannel).mockReturnValue(joinedVoiceMock);
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    // Still viewing server A, channels genuinely reloaded for server A
    // (channelsServerId unchanged), but the voice channel itself is gone
    // from that fresh list now (deleted).
    useServerStore.setState({ channels: [] });
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(joinedVoiceMock.leave).toHaveBeenCalled();
  });

  it('returning to the voice room\'s own server while channelsServerId hasn\'t caught up yet (fetch still in flight) does not hang up the call', () => {
    useServerStore.setState({
      servers: [serverA, serverB],
      activeServerId: serverA.id,
      channels: [voiceChannelA],
      channelsServerId: serverA.id,
    });
    const { rerender } = render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByText('ses-a'));

    const joinedVoiceMock = makeVoiceMock({ activeRoomId: voiceChannelA.id });
    vi.mocked(useVoiceChannel).mockReturnValue(joinedVoiceMock);
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    // Navigate to server B, its fetch has already resolved.
    useServerStore.setState({
      activeServerId: serverB.id,
      channels: [textChannelB],
      channelsServerId: serverB.id,
    });
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);
    expect(joinedVoiceMock.leave).not.toHaveBeenCalled();

    // Navigate BACK to server A — activeServerId flips synchronously (as
    // setActiveServerId does for real), but channelsServerId/channels
    // haven't caught up yet (loadChannelsForActiveServer's fetch for A is
    // still in flight) — this is the exact race window the bug report
    // described: activeServerId === voiceRoomServerId is now true, but
    // channels still (wrongly) looks like it doesn't contain the room.
    useServerStore.setState({ activeServerId: serverA.id });
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(joinedVoiceMock.leave).not.toHaveBeenCalled();

    // Once the real fetch for A resolves (channels + channelsServerId both
    // catch up together, as loadChannelsForActiveServer's single `set`
    // call does), the room is correctly found again and nothing changes.
    useServerStore.setState({ channels: [voiceChannelA], channelsServerId: serverA.id });
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(joinedVoiceMock.leave).not.toHaveBeenCalled();
  });

  // removeServerAndDeselect is what "member_kicked", "server_deleted" and
  // leaving a server all boil down to. It nulls activeServerId when the
  // removed server was the one being viewed, which the channel-list effect
  // above can never match against voiceRoomServerId — so before this, a
  // kicked member's client kept its microphone and peer connections open.
  it('the voice room\'s server being removed (kicked/left/deleted) while viewing it hangs up the call', () => {
    useServerStore.setState({
      servers: [serverA, serverB],
      activeServerId: serverA.id,
      channels: [voiceChannelA],
      channelsServerId: serverA.id,
    });
    const { rerender } = render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByText('ses-a'));

    const joinedVoiceMock = makeVoiceMock({ activeRoomId: voiceChannelA.id });
    vi.mocked(useVoiceChannel).mockReturnValue(joinedVoiceMock);
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    act(() => useServerStore.getState().removeServerAndDeselect(serverA.id));
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(joinedVoiceMock.leave).toHaveBeenCalled();
  });

  it('the voice room\'s server being removed while viewing a DIFFERENT server still hangs up the call', () => {
    useServerStore.setState({
      servers: [serverA, serverB],
      activeServerId: serverA.id,
      channels: [voiceChannelA],
      channelsServerId: serverA.id,
    });
    const { rerender } = render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByText('ses-a'));

    const joinedVoiceMock = makeVoiceMock({ activeRoomId: voiceChannelA.id });
    vi.mocked(useVoiceChannel).mockReturnValue(joinedVoiceMock);
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    useServerStore.setState({
      activeServerId: serverB.id,
      channels: [textChannelB],
      channelsServerId: serverB.id,
    });
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);
    expect(joinedVoiceMock.leave).not.toHaveBeenCalled();

    act(() => useServerStore.getState().removeServerAndDeselect(serverA.id));
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(joinedVoiceMock.leave).toHaveBeenCalled();
  });

  it('removing an unrelated server does not hang up the call', () => {
    useServerStore.setState({
      servers: [serverA, serverB],
      activeServerId: serverA.id,
      channels: [voiceChannelA],
      channelsServerId: serverA.id,
    });
    const { rerender } = render(<Chat user={testUser} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByText('ses-a'));

    const joinedVoiceMock = makeVoiceMock({ activeRoomId: voiceChannelA.id });
    vi.mocked(useVoiceChannel).mockReturnValue(joinedVoiceMock);
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    act(() => useServerStore.getState().removeServerAndDeselect(serverB.id));
    rerender(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(joinedVoiceMock.leave).not.toHaveBeenCalled();
  });
});

describe('Chat — ses kanalı doluluk önizlemesi (voice_occupants)', () => {
  const server: Server = { id: 'srv-occ', name: 'Sunucu', owner_id: 'owner-1' };
  const voiceChannel: Channel = {
    id: 'vc-occ',
    name: 'ses-occ',
    type: 'voice',
    parent_id: null,
    position: 0,
    voice_occupants: [
      { user_id: 'u2', username: 'diğer-kullanıcı' },
      { user_id: 'u3', username: 'başka-kullanıcı' },
    ],
  };

  it('kanala katılmadan önce voice_occupants doluysa altında bir önizleme listesi render edilir', () => {
    useServerStore.setState({ servers: [server], activeServerId: server.id, channels: [voiceChannel] });

    render(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(screen.getByText('diğer-kullanıcı')).not.toBeNull();
    expect(screen.getByText('başka-kullanıcı')).not.toBeNull();
  });

  it('profil fotoğrafı olan kişinin önizlemesinde baş harfler yerine fotoğrafı gösterilir', () => {
    const withAvatar: Channel = {
      ...voiceChannel,
      voice_occupants: [{ user_id: 'u2', username: 'diğer-kullanıcı', avatar_url: '/uploads/u2.png' }],
    };
    useServerStore.setState({ servers: [server], activeServerId: server.id, channels: [withAvatar] });

    const { container } = render(<Chat user={testUser} onLogout={vi.fn()} />);

    const img = container.querySelector<HTMLImageElement>('.voice-occupant-preview-avatar img');
    expect(img?.getAttribute('src')).toContain('/uploads/u2.png');
  });

  it('çevrimiçi listesinde profil fotoğrafı gösterilir', () => {
    useServerStore.setState({ servers: [server], activeServerId: server.id, channels: [] });
    const { container } = render(<Chat user={testUser} onLogout={vi.fn()} />);

    act(() =>
      useChatStore.setState({
        onlineUsers: [{ user_id: 'u2', username: 'çevrimiçi-kişi', online_at: 1, avatar_url: '/uploads/on.png' }],
      })
    );

    const img = container.querySelector<HTMLImageElement>('.online-user-avatar img');
    expect(img?.getAttribute('src')).toContain('/uploads/on.png');
  });

  it('voice_occupants boş/tanımsızsa önizleme render edilmez', () => {
    const emptyVoiceChannel: Channel = { ...voiceChannel, voice_occupants: [] };
    useServerStore.setState({ servers: [server], activeServerId: server.id, channels: [emptyVoiceChannel] });

    render(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(screen.queryByText('diğer-kullanıcı')).toBeNull();
  });

  it('kullanıcı zaten o kanaldayken (isActive) önizleme gizlenir — VoiceOrbit ile çakışmaz', () => {
    useServerStore.setState({ servers: [server], activeServerId: server.id, channels: [voiceChannel] });
    vi.mocked(useVoiceChannel).mockReturnValue(makeVoiceMock({ activeRoomId: voiceChannel.id }));

    render(<Chat user={testUser} onLogout={vi.fn()} />);

    expect(screen.queryByText('diğer-kullanıcı')).toBeNull();
    expect(screen.queryByText('başka-kullanıcı')).toBeNull();
  });
});

// PROJECT_ARCHITECTURE.md §7 #11 — a rejected push's feedback appears in
// the existing slot under the composer.
describe('Chat — başarısız işlem geri bildirimi', () => {
  it('actionError composer altında bir uyarı olarak gösterilir', () => {
    setupActiveChannel();
    render(<Chat user={testUser} onLogout={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();

    // Set after mounting: joining the channel on mount runs
    // resetForChannelSwitch, which (correctly) clears any earlier feedback.
    act(() => {
      useChatStore.setState({ actionError: 'Mesaj gönderilemedi. Lütfen tekrar deneyin.' });
    });

    expect(screen.getByRole('alert').textContent).toContain('Mesaj gönderilemedi. Lütfen tekrar deneyin.');
  });
});

describe('Chat — ses kanalı: tekrar tıklama, sessiz katılma, bağlanıyor, mikrofon izni', () => {
  const server: Server = { id: 'srv-v', name: 'Sunucu V', owner_id: 'owner-1' };
  const voiceChannel: Channel = { id: 'vc-v', name: 'ses-v', type: 'voice', parent_id: null, position: 0 };

  function renderInServer(voiceOverrides: Partial<ReturnType<typeof useVoiceChannel>> = {}) {
    useServerStore.setState({
      servers: [server],
      activeServerId: server.id,
      channels: [voiceChannel],
      channelsServerId: server.id,
    });
    const mock = makeVoiceMock(voiceOverrides);
    vi.mocked(useVoiceChannel).mockReturnValue(mock);
    render(<Chat user={testUser} onLogout={vi.fn()} />);
    return mock;
  }

  it('içinde olduğun ses kanalına tekrar tıklamak seni çıkarmaz', () => {
    const mock = renderInServer({ activeRoomId: voiceChannel.id });
    fireEvent.click(screen.getAllByText('ses-v')[0]);
    expect(mock.leave).not.toHaveBeenCalled();
    expect(mock.join).not.toHaveBeenCalled();
  });

  it('Shift ile tıklamak ve "Sessiz katıl" düğmesi mikrofon kapalı katılır', () => {
    const mock = renderInServer();
    fireEvent.click(screen.getByText('ses-v'), { shiftKey: true });
    expect(mock.join).toHaveBeenLastCalledWith(voiceChannel.id, { muted: true });

    fireEvent.click(screen.getByRole('button', { name: 'ses-v kanalına sessiz katıl' }));
    expect(mock.join).toHaveBeenLastCalledWith(voiceChannel.id, { muted: true });

    fireEvent.click(screen.getByText('ses-v'));
    expect(mock.join).toHaveBeenLastCalledWith(voiceChannel.id, { muted: false });
  });

  it('bağlanırken kanal kartında "Bağlanıyor…" görünür', () => {
    renderInServer({ joiningRoomId: voiceChannel.id });
    expect(screen.getByText('Bağlanıyor…')).not.toBeNull();
  });

  it('mikrofon izni yoksa yardım kartı çıkar; "Tekrar dene" aynı kanala yeniden katılır', () => {
    const mock = renderInServer({ micBlocked: true, error: 'Mikrofon izni verilmedi.' });
    expect(screen.getByText('Mikrofon izni gerekli')).not.toBeNull();
    expect(screen.queryByText('Mikrofon izni verilmedi.')).toBeNull();

    // Önce bir katılma denemesi olmalı ki "Tekrar dene" neyi deneyeceğini bilsin.
    fireEvent.click(screen.getByText('ses-v'));
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(mock.join).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByText('Mikrofon izni gerekli')).toBeNull();
  });
});
