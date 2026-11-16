import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ActiveSessions from '../ActiveSessions';
import type { ActiveSession } from '../../types';

vi.mock('../../services/api', () => ({
  fetchSessions: vi.fn(),
  revokeSession: vi.fn(),
}));

import { fetchSessions, revokeSession } from '../../services/api';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';

function session(overrides: Partial<ActiveSession>): ActiveSession {
  return {
    id: 's',
    user_agent: CHROME,
    ip: '85.105.1.10',
    created_at: '2026-11-10T10:00:00Z',
    last_seen_at: '2026-11-16T10:00:00Z',
    current: false,
    ...overrides,
  };
}

const SESSIONS = [
  session({ id: 'here', current: true }),
  session({ id: 'phone', user_agent: IPHONE, ip: '176.33.2.20' }),
  session({ id: 'linux', user_agent: FIREFOX, ip: '10.0.0.5' }),
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ActiveSessions', () => {
  it('lists each device with its IP and marks this one', async () => {
    vi.mocked(fetchSessions).mockResolvedValue({ data: SESSIONS });
    render(<ActiveSessions />);

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText('Chrome · Windows')).toBeInTheDocument();
    expect(within(items[0]).getByText('Bu cihaz')).toBeInTheDocument();
    expect(within(items[0]).queryByRole('button')).toBeNull();
    expect(within(items[1]).getByText('Safari · iPhone')).toBeInTheDocument();
    expect(within(items[1]).getByText(/176\.33\.2\.20/)).toBeInTheDocument();
  });

  it('signs one session out and drops it from the list', async () => {
    vi.mocked(fetchSessions).mockResolvedValue({ data: SESSIONS });
    vi.mocked(revokeSession).mockResolvedValue({ data: undefined });
    render(<ActiveSessions />);

    fireEvent.click(await screen.findByRole('button', { name: 'Safari · iPhone oturumunu kapat' }));

    await waitFor(() => expect(screen.queryByText('Safari · iPhone')).toBeNull());
    expect(revokeSession).toHaveBeenCalledWith('phone');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('signs out every other session, keeping this one', async () => {
    vi.mocked(fetchSessions).mockResolvedValue({ data: SESSIONS });
    vi.mocked(revokeSession).mockResolvedValue({ data: undefined });
    render(<ActiveSessions />);

    fireEvent.click(await screen.findByRole('button', { name: 'Diğer tüm oturumları kapat' }));

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(vi.mocked(revokeSession).mock.calls.map(([id]) => id).sort()).toEqual(['linux', 'phone']);
  });

  it('shows the error if signing out fails, and keeps the session listed', async () => {
    vi.mocked(fetchSessions).mockResolvedValue({ data: SESSIONS });
    vi.mocked(revokeSession).mockResolvedValue({ error: 'Oturum bulunamadı' });
    render(<ActiveSessions />);

    fireEvent.click(await screen.findByRole('button', { name: 'Safari · iPhone oturumunu kapat' }));

    expect(await screen.findByText('Oturum bulunamadı')).toBeInTheDocument();
    expect(screen.getByText('Safari · iPhone')).toBeInTheDocument();
  });
});
