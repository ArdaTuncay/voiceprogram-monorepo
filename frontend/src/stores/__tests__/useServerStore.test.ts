import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerStore } from '../useServerStore';
import { useDMStore } from '../useDMStore';

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
