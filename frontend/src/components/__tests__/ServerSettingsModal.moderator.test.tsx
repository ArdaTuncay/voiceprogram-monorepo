import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ServerSettingsModal from '../ServerSettingsModal';
import { useServerStore } from '../../stores/useServerStore';
import type { Server } from '../../types';

vi.mock('../../services/api', () => ({
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
  deleteChannel: vi.fn(),
  kickMember: vi.fn(),
  banMember: vi.fn(),
  fetchServerBans: vi.fn(() => Promise.resolve({ data: [] })),
  unbanMember: vi.fn(),
  fetchServerMembers: vi.fn(),
  fetchServerInvites: vi.fn(() => Promise.resolve({ data: [] })),
  revokeInvite: vi.fn(),
  setMemberRole: vi.fn(),
}));

import { fetchServerMembers, setMemberRole } from '../../services/api';

function useServerAs(myRole: Server['my_role']) {
  const server: Server = { id: 'srv-1', name: 'Sunucu', owner_id: 'owner-1', my_role: myRole };
  useServerStore.setState({ servers: [server], activeServerId: server.id, channels: [], memberStatuses: {} });
}

beforeEach(() => {
  vi.mocked(fetchServerMembers).mockResolvedValue({
    data: [
      { user_id: 'owner-1', username: 'sahip', role: 'owner', status: 'online' },
      { user_id: 'mod-2', username: 'gozcu', role: 'moderator', status: 'online' },
      { user_id: 'user-3', username: 'sorunlu', role: 'member', status: 'online' },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openMembers() {
  render(<ServerSettingsModal onClose={vi.fn()} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Üyeler' }));
  });
  await screen.findByText('sorunlu');
}

describe('ServerSettingsModal — moderatör', () => {
  it('shows a moderator only the members and bans tabs', () => {
    useServerAs('moderator');
    render(<ServerSettingsModal onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Üyeler' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Yasaklılar' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Genel Ayarlar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kanalları Yönet' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Davet Linkleri' })).toBeNull();
  });

  it('lets a moderator kick or ban regular members only, and not change roles', async () => {
    useServerAs('moderator');
    await openMembers();

    expect(screen.getByRole('button', { name: 'sorunlu sunucudan at' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'sorunlu sunucudan yasakla' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'gozcu sunucudan at' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'sahip sunucudan at' })).toBeNull();
    expect(screen.queryByRole('button', { name: /moderatör yap/i })).toBeNull();
    expect(screen.getByText('Moderatör')).not.toBeNull();
  });

  it('lets the owner promote a member and demote a moderator', async () => {
    useServerAs('owner');
    vi.mocked(setMemberRole).mockResolvedValue({ data: { user_id: 'user-3', role: 'moderator' } });
    await openMembers();

    expect(screen.getByRole('button', { name: 'gozcu sunucudan at' })).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'sorunlu moderatör yap' }));
    });
    expect(setMemberRole).toHaveBeenCalledWith('srv-1', 'user-3', 'moderator');
    expect(screen.getByRole('button', { name: 'sorunlu moderatörlüğünü al' })).not.toBeNull();

    vi.mocked(setMemberRole).mockResolvedValue({ data: { user_id: 'mod-2', role: 'member' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'gozcu moderatörlüğünü al' }));
    });
    expect(setMemberRole).toHaveBeenCalledWith('srv-1', 'mod-2', 'member');
  });
});
