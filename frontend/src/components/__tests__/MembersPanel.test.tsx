import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import MembersPanel from '../MembersPanel';
import { fetchServerMembers } from '../../services/api';

vi.mock('../../services/api', () => ({
  fetchServerMembers: vi.fn(),
}));

afterEach(cleanup);

const members = [
  { user_id: 'u1', username: 'arda', role: 'owner' as const, status: 'online' as const },
  { user_id: 'u2', username: 'ece', role: 'moderator' as const, status: 'online' as const },
  { user_id: 'u3', username: 'mert', role: 'member' as const, status: 'offline' as const },
  { user_id: 'u4', username: 'deniz', role: 'member' as const, status: 'online' as const },
];

const online = [
  { user_id: 'u1', username: 'arda', online_at: 0 },
  { user_id: 'u2', username: 'ece', online_at: 0 },
];

beforeEach(() => {
  vi.mocked(fetchServerMembers).mockResolvedValue({ data: members });
});

describe('MembersPanel', () => {
  it('kapalıyken yalnız çevrimiçi üyeleri ve sayılarını gösterir', async () => {
    render(<MembersPanel serverId="s1" onlineUsers={online} currentUserId="u1" />);

    expect(screen.getByText('2 çevrimiçi')).not.toBeNull();
    expect(screen.getByText('arda (sen)')).not.toBeNull();
    expect(screen.getByText('ece')).not.toBeNull();
    expect(screen.queryByText('mert')).toBeNull();
    // Rol etiketleri üye listesi gelince görünür.
    await waitFor(() => expect(screen.getByText('Sahip')).not.toBeNull());
  });

  it('ok ile açılınca tüm üyeler rollerine göre gruplanır, çevrimdışılar soluk', async () => {
    const { container } = render(<MembersPanel serverId="s1" onlineUsers={online} currentUserId="u1" />);

    const toggle = screen.getByRole('button', { name: 'Tüm üyeleri göster' });
    fireEvent.click(toggle);

    await waitFor(() => expect(screen.getByText('4 üye')).not.toBeNull());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const memberGroup = screen.getByRole('region', { name: 'Üyeler' });
    expect(within(memberGroup).getByText('mert')).not.toBeNull();
    expect(within(memberGroup).getByText('deniz')).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Moderatörler' })).not.toBeNull();
    expect(container.querySelectorAll('.members-row.offline')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Yalnız çevrimiçi üyeleri göster' }));
    expect(screen.queryByText('mert')).toBeNull();
  });

  it('liste alınamazsa açıkken hata gösterir', async () => {
    vi.mocked(fetchServerMembers).mockResolvedValue({ error: 'Üye listesi alınamadı' });
    render(<MembersPanel serverId="s1" onlineUsers={online} currentUserId="u1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Tüm üyeleri göster' }));
    await waitFor(() => expect(screen.getByText(/Üye listesi alınamadı/)).not.toBeNull());
  });
});
