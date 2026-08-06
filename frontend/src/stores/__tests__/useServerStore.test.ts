import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerStore } from '../useServerStore';
import { useDMStore } from '../useDMStore';
import type { Channel } from '../../types';

vi.mock('../../services/api', () => ({
  fetchServers: vi.fn().mockResolvedValue({ data: [] }),
  createServer: vi.fn(),
  fetchServerChannels: vi.fn().mockResolvedValue({ data: [] }),
  fetchServerMembers: vi.fn().mockResolvedValue({ data: [] }),
  acceptInvite: vi.fn(),
  createChannel: vi.fn(),
  updateChannelPositions: vi.fn(),
  leaveServer: vi.fn(),
}));

describe('useServerStore.setActiveServerId — DM aktif oda resetleme', () => {
  beforeEach(() => {
    useServerStore.getState().reset();
    useDMStore.getState().reset();
    vi.clearAllMocks();
  });

  it('bir sunucu seçildiğinde (serverId dolu) useDMStore.activeRoomId sıfırlanır', () => {
    useDMStore.setState({ activeRoomId: 'room-1' });

    useServerStore.getState().setActiveServerId('server-1');

    expect(useDMStore.getState().activeRoomId).toBeNull();
  });

  it('Arkadaşlar/Home\'a dönülürken (serverId=null) de useDMStore.activeRoomId sıfırlanır', () => {
    useDMStore.setState({ activeRoomId: 'room-1' });

    useServerStore.getState().setActiveServerId(null);

    expect(useDMStore.getState().activeRoomId).toBeNull();
  });

  it('zaten aktif oda yokken sunucu seçmek hâlâ null bırakır (no-op güvenli)', () => {
    expect(useDMStore.getState().activeRoomId).toBeNull();

    useServerStore.getState().setActiveServerId('server-1');

    expect(useDMStore.getState().activeRoomId).toBeNull();
  });
});

describe('useServerStore.handleVoicePresenceUpdated', () => {
  beforeEach(() => {
    useServerStore.getState().reset();
  });

  it('sadece channel_id eşleşen kanalın voice_occupants\'ını günceller, diğerlerine dokunmaz', () => {
    const voiceChannel: Channel = { id: 'vc-1', name: 'ses', type: 'voice', parent_id: null, position: 0 };
    const textChannel: Channel = { id: 'ch-1', name: 'genel', type: 'text', parent_id: null, position: 1 };
    useServerStore.setState({ channels: [voiceChannel, textChannel] });

    useServerStore.getState().handleVoicePresenceUpdated({
      channel_id: 'vc-1',
      users: [{ user_id: 'u1', username: 'Ada' }],
    });

    const channels = useServerStore.getState().channels;
    expect(channels.find((c) => c.id === 'vc-1')?.voice_occupants).toEqual([
      { user_id: 'u1', username: 'Ada' },
    ]);
    expect(channels.find((c) => c.id === 'ch-1')?.voice_occupants).toBeUndefined();
  });

  it('channel_id şu an yüklü channels listesinde yoksa no-op\'tur (state referansı değişmez)', () => {
    const textChannel: Channel = { id: 'ch-1', name: 'genel', type: 'text', parent_id: null, position: 0 };
    useServerStore.setState({ channels: [textChannel] });
    const before = useServerStore.getState().channels;

    useServerStore.getState().handleVoicePresenceUpdated({
      channel_id: 'not-loaded',
      users: [{ user_id: 'u1', username: 'Ada' }],
    });

    expect(useServerStore.getState().channels).toBe(before);
  });

  it('önceki occupant listesini merge etmek yerine tamamen değiştirir', () => {
    const voiceChannel: Channel = {
      id: 'vc-1',
      name: 'ses',
      type: 'voice',
      parent_id: null,
      position: 0,
      voice_occupants: [{ user_id: 'stale', username: 'Eski' }],
    };
    useServerStore.setState({ channels: [voiceChannel] });

    useServerStore.getState().handleVoicePresenceUpdated({ channel_id: 'vc-1', users: [] });

    expect(useServerStore.getState().channels[0].voice_occupants).toEqual([]);
  });
});

describe('useDMStore.setActiveRoomId — DM’den DM’e geçiş', () => {
  beforeEach(() => {
    useDMStore.getState().reset();
  });

  it('bir DM’den başka bir DM’ye geçilince activeRoomId yeni odaya güncellenir, eski oda kalmaz', () => {
    useDMStore.getState().setActiveRoomId('room-a');
    expect(useDMStore.getState().activeRoomId).toBe('room-a');

    useDMStore.getState().setActiveRoomId('room-b');

    expect(useDMStore.getState().activeRoomId).toBe('room-b');
  });
});
