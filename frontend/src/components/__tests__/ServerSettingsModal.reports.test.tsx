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
  fetchServerBans: vi.fn(() => Promise.resolve({ data: [] })),
  unbanMember: vi.fn(),
  fetchServerMembers: vi.fn(() => Promise.resolve({ data: [] })),
  fetchServerInvites: vi.fn(() => Promise.resolve({ data: [] })),
  revokeInvite: vi.fn(),
  setMemberRole: vi.fn(),
  fetchServerReports: vi.fn(),
  reviewReport: vi.fn(),
}));

import { fetchServerReports, reviewReport } from '../../services/api';

const report = {
  id: 'r1',
  reason: 'harassment' as const,
  details: 'bana hakaret etti',
  content: 'kötü söz',
  file_url: null,
  message_id: 'm1',
  status: 'open' as const,
  created_at: '2026-11-16T10:00:00Z',
  reporter: { id: 'u1', username: 'raporlayan' },
  reported_user: { id: 'u2', username: 'sorunlu' },
};

beforeEach(() => {
  useServerStore.setState({
    servers: [{ id: 'srv-1', name: 'Sunucu', owner_id: 'owner-1', my_role: 'moderator' }],
    activeServerId: 'srv-1',
    channels: [],
    memberStatuses: {},
    reportServerIds: new Set(['srv-1']),
  });
  vi.mocked(fetchServerReports).mockResolvedValue({ data: [report] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openReports() {
  render(<ServerSettingsModal onClose={vi.fn()} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Raporlar' }));
  });
  await screen.findByText('kötü söz');
}

describe('ServerSettingsModal — raporlar', () => {
  it('lists open reports with who, why and the reported message', async () => {
    await openReports();

    expect(screen.getByText('sorunlu')).not.toBeNull();
    expect(screen.getByText(/raporlayan/)).not.toBeNull();
    expect(screen.getByText('Taciz veya zorbalık')).not.toBeNull();
    expect(screen.getByText('bana hakaret etti')).not.toBeNull();
  });

  it('opening the tab clears the new-report marker for this server', async () => {
    await openReports();
    expect(useServerStore.getState().reportServerIds.has('srv-1')).toBe(false);
  });

  it('resolves or dismisses a report and removes it from the list', async () => {
    vi.mocked(reviewReport).mockResolvedValue({ data: { id: 'r1', status: 'resolved' } });
    await openReports();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Çözüldü' }));
    });

    expect(reviewReport).toHaveBeenCalledWith('srv-1', 'r1', 'resolved');
    await waitFor(() => expect(screen.queryByText('kötü söz')).toBeNull());
  });
});
