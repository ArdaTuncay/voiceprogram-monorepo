import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import UserSettingsModal from '../UserSettingsModal';
import type { User } from '../../types';

vi.mock('../../services/push', () => ({
  getPushState: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  needsHomeScreenInstall: vi.fn(() => false),
}));

vi.mock('../../services/socket', () => ({ disconnectSocket: vi.fn() }));
vi.mock('../../services/session', () => ({ forceLogout: vi.fn() }));

import { disablePush, enablePush, getPushState, needsHomeScreenInstall } from '../../services/push';

const user: User = { id: 'u1', username: 'ardatuncay', email: 'arda@example.com' };

async function openNotifications() {
  render(<UserSettingsModal user={user} onClose={vi.fn()} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Bildirimler' }));
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Bildirimler → Uygulama kapalıyken', () => {
  it('turns notifications for this device on, then off', async () => {
    vi.mocked(getPushState).mockResolvedValueOnce('off').mockResolvedValueOnce('on').mockResolvedValueOnce('off');
    vi.mocked(enablePush).mockResolvedValue(null);
    await openNotifications();

    const toggle = screen.getByLabelText('DM ve bahsedilmelerde bu cihaza bildirim gönder');
    expect(toggle).toHaveProperty('checked', false);

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(enablePush).toHaveBeenCalled();
    expect(toggle).toHaveProperty('checked', true);

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(disablePush).toHaveBeenCalled();
    expect(toggle).toHaveProperty('checked', false);
  });

  it('shows why it could not be turned on', async () => {
    vi.mocked(getPushState).mockResolvedValue('off');
    vi.mocked(enablePush).mockResolvedValue('Bildirim aboneliği oluşturulamadı.');
    await openNotifications();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('DM ve bahsedilmelerde bu cihaza bildirim gönder'));
    });

    expect(screen.getByText('Bildirim aboneliği oluşturulamadı.')).toBeInTheDocument();
  });

  it('is disabled with an explanation when the site is blocked', async () => {
    vi.mocked(getPushState).mockResolvedValue('denied');
    await openNotifications();

    expect(screen.getByLabelText('DM ve bahsedilmelerde bu cihaza bildirim gönder')).toBeDisabled();
    expect(screen.getByText(/tarayıcı ayarlarından engellenmiş/)).toBeInTheDocument();
  });

  it('is hidden where it cannot work, except for the iPhone home-screen hint', async () => {
    vi.mocked(getPushState).mockResolvedValue('unavailable');
    await openNotifications();
    expect(screen.queryByText('Uygulama kapalıyken')).toBeNull();
    cleanup();

    vi.mocked(getPushState).mockResolvedValue('unsupported');
    vi.mocked(needsHomeScreenInstall).mockReturnValue(true);
    await openNotifications();
    expect(screen.getByText(/Ana Ekrana Ekle/)).toBeInTheDocument();
  });
});
