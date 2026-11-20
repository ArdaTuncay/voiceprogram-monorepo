import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../services/api', () => ({
  previewInvite: vi.fn(),
  acceptInvite: vi.fn(),
  fetchServerChannels: vi.fn(() => Promise.resolve({ data: [] })),
}));

import InvitePage from '../InvitePage';
import { acceptInvite, previewInvite } from '../../services/api';
import { clearStoredSession, storeToken } from '../../services/tokenStorage';

const preview = { server_name: 'Oyun Gecesi', server_icon_url: null, inviter_username: 'ayse' };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  clearStoredSession();
  sessionStorage.clear();
});

async function renderPage(onJoined = vi.fn()) {
  await act(async () => {
    render(<InvitePage code="abc123" onJoined={onJoined} />);
  });
  return onJoined;
}

describe('InvitePage', () => {
  it('shows the server and who sent the invite', async () => {
    vi.mocked(previewInvite).mockResolvedValue({ data: preview });
    await renderPage();

    expect(previewInvite).toHaveBeenCalledWith('abc123');
    expect(screen.getByRole('heading', { level: 1, name: 'Oyun Gecesi' })).toBeInTheDocument();
    expect(screen.getByText('ayse seni bu sunucuya davet etti')).toBeInTheDocument();
    expect(screen.getByText('OG')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Önce Windows uygulamasını indir' })).toHaveAttribute('href', '/indir');
  });

  it('says so when the invite is unknown, expired or used up', async () => {
    vi.mocked(previewInvite).mockResolvedValue({ error: 'Invite not found' });
    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Bu davet geçerli değil' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tarayıcıda katıl' })).toBeNull();
  });

  it('remembers the invite and goes to sign in when signed out', async () => {
    vi.mocked(previewInvite).mockResolvedValue({ data: preview });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Tarayıcıda katıl' }));

    expect(sessionStorage.getItem('zircle.pendingInvite')).toBe('abc123');
    expect(assign).toHaveBeenCalledWith('/giris');
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it('joins right away when signed in', async () => {
    vi.mocked(previewInvite).mockResolvedValue({ data: preview });
    vi.mocked(acceptInvite).mockResolvedValue({ data: { id: 's1', name: 'Oyun Gecesi', owner_id: 'u2' } });
    storeToken('oturum');
    const onJoined = await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tarayıcıda katıl' }));
    });

    expect(acceptInvite).toHaveBeenCalledWith('abc123');
    expect(onJoined).toHaveBeenCalled();
  });

  it('shows why joining failed', async () => {
    vi.mocked(previewInvite).mockResolvedValue({ data: preview });
    vi.mocked(acceptInvite).mockResolvedValue({ error: 'Bu sunucudan yasaklandın' });
    storeToken('oturum');
    const onJoined = await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tarayıcıda katıl' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Bu sunucudan yasaklandın');
    expect(onJoined).not.toHaveBeenCalled();
  });
});
