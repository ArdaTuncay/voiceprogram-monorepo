import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ServerSettingsModal from '../ServerSettingsModal';
import { useServerStore } from '../../stores/useServerStore';

vi.mock('../../services/api', () => ({
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
  deleteChannel: vi.fn(),
  kickMember: vi.fn(),
  banMember: vi.fn(),
  fetchServerBans: vi.fn(),
  unbanMember: vi.fn(),
  fetchServerMembers: vi.fn(),
  fetchServerInvites: vi.fn(() => Promise.resolve({ data: [] })),
  revokeInvite: vi.fn(),
}));

import { banMember, fetchServerBans, fetchServerMembers, unbanMember } from '../../services/api';

const server = { id: 'srv-1', name: 'Sunucu', owner_id: 'owner-1' };

beforeEach(() => {
  useServerStore.setState({ servers: [server], activeServerId: server.id, channels: [], memberStatuses: {} });
  vi.mocked(fetchServerMembers).mockResolvedValue({
    data: [
      { user_id: 'owner-1', username: 'sahip', role: 'owner', status: 'online' },
      { user_id: 'user-2', username: 'sorunlu', role: 'member', status: 'online' },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openTab(name: string) {
  render(<ServerSettingsModal onClose={vi.fn()} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

describe('ServerSettingsModal — yasaklama', () => {
  it('bans only after an explicit confirmation, sending the optional reason', async () => {
    vi.mocked(banMember).mockResolvedValue({ data: {} });
    await openTab('Üyeler');

    fireEvent.click(await screen.findByRole('button', { name: 'sorunlu sunucudan yasakla' }));
    expect(banMember).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Yasaklama sebebi'), { target: { value: ' spam ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yasakla' }));
    });

    expect(banMember).toHaveBeenCalledWith('srv-1', 'user-2', 'spam');
    await waitFor(() => expect(screen.queryByText('sorunlu')).toBeNull());
  });

  it('can back out of the confirmation', async () => {
    await openTab('Üyeler');

    fireEvent.click(await screen.findByRole('button', { name: 'sorunlu sunucudan yasakla' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));

    expect(screen.queryByLabelText('Yasaklama sebebi')).toBeNull();
    expect(banMember).not.toHaveBeenCalled();
  });

  it('offers no ban button for the owner', async () => {
    await openTab('Üyeler');
    await screen.findByText('sorunlu');

    expect(screen.queryByRole('button', { name: 'sahip sunucudan yasakla' })).toBeNull();
  });

  it('lists bans with their reason and lifts one', async () => {
    vi.mocked(fetchServerBans).mockResolvedValue({
      data: [{ user_id: 'user-2', username: 'sorunlu', reason: 'spam', banned_at: '2026-11-15T10:00:00Z' }],
    });
    vi.mocked(unbanMember).mockResolvedValue({});
    await openTab('Yasaklılar');

    expect(await screen.findByText('sorunlu')).not.toBeNull();
    expect(screen.getByText(/spam/)).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yasağı kaldır' }));
    });

    expect(unbanMember).toHaveBeenCalledWith('srv-1', 'user-2');
    expect(await screen.findByText('Yasaklı kullanıcı yok.')).not.toBeNull();
  });
});
