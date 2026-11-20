import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../services/api', () => ({
  createInvite: vi.fn(() => Promise.resolve({ data: { id: 'i1', code: 'abc123' } })),
}));

import InviteModal from '../InviteModal';
import { useServerStore } from '../../stores/useServerStore';
import { inviteLink } from '../../utils/inviteLink';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('InviteModal', () => {
  it('offers a shareable link next to the code', async () => {
    useServerStore.setState({ activeServerId: 's1' });
    await act(async () => {
      render(<InviteModal onClose={vi.fn()} />);
    });

    expect(screen.getByLabelText('Davet bağlantısı')).toHaveValue(`${window.location.origin}/davet/abc123`);
    expect(screen.getByLabelText('Davet kodu')).toHaveValue('abc123');
  });
});

describe('inviteLink', () => {
  it("uses the site's public address in the desktop app (file://)", () => {
    vi.stubGlobal('location', { protocol: 'file:', origin: 'null' });
    expect(inviteLink('abc123')).toBe('https://zircle.vercel.app/davet/abc123');

    vi.stubEnv('VITE_SITE_URL', 'https://zircle.example/');
    expect(inviteLink('abc123')).toBe('https://zircle.example/davet/abc123');
  });
});
