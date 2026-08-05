import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import NotificationPermissionBanner, { BANNER_DISMISSED_KEY } from '../NotificationPermissionBanner';

const PREFS_KEY = 'zircle-notification-prefs';

function setDesktopPreference(desktop: boolean) {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({ enabled: true, sound: false, desktop, mentionsOnly: false })
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
});

describe('NotificationPermissionBanner', () => {
  it('renders nothing when the Notification API does not exist (no global stubbed)', () => {
    setDesktopPreference(true);

    render(<NotificationPermissionBanner />);

    expect(screen.queryByText('Bildirimleri Etkinleştir')).toBeNull();
  });

  it('renders nothing when the desktop preference is off', () => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
    setDesktopPreference(false);

    render(<NotificationPermissionBanner />);

    expect(screen.queryByText('Bildirimleri Etkinleştir')).toBeNull();
  });

  it('renders nothing when permission is already granted', () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    setDesktopPreference(true);

    render(<NotificationPermissionBanner />);

    expect(screen.queryByText('Bildirimleri Etkinleştir')).toBeNull();
  });

  it('renders nothing when permission is already denied', () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });
    setDesktopPreference(true);

    render(<NotificationPermissionBanner />);

    expect(screen.queryByText('Bildirimleri Etkinleştir')).toBeNull();
  });

  it('renders nothing when the user already dismissed it', () => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
    setDesktopPreference(true);
    localStorage.setItem(BANNER_DISMISSED_KEY, 'true');

    render(<NotificationPermissionBanner />);

    expect(screen.queryByText('Bildirimleri Etkinleştir')).toBeNull();
  });

  it('renders when desktop is on, permission is default, and it has not been dismissed', () => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
    setDesktopPreference(true);

    render(<NotificationPermissionBanner />);

    expect(screen.getByText('Bildirimleri Etkinleştir')).not.toBeNull();
  });

  it('calls requestPermission from the button click handler, then dismisses on grant', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    setDesktopPreference(true);

    render(<NotificationPermissionBanner />);
    await act(async () => {
      fireEvent.click(screen.getByText('Bildirimleri Etkinleştir'));
    });

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Bildirimleri Etkinleştir')).toBeNull();
    expect(localStorage.getItem(BANNER_DISMISSED_KEY)).toBe('true');
  });

  it('still dismisses (and persists the flag) even when permission is denied', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    setDesktopPreference(true);

    render(<NotificationPermissionBanner />);
    await act(async () => {
      fireEvent.click(screen.getByText('Bildirimleri Etkinleştir'));
    });

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Bildirimleri Etkinleştir')).toBeNull();
    expect(localStorage.getItem(BANNER_DISMISSED_KEY)).toBe('true');
  });

  it('dismisses without ever calling requestPermission when the close (x) icon is clicked', () => {
    const requestPermission = vi.fn();
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    setDesktopPreference(true);

    render(<NotificationPermissionBanner />);
    fireEvent.click(screen.getByLabelText('Kapat'));

    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.queryByText('Bildirimleri Etkinleştir')).toBeNull();
    expect(localStorage.getItem(BANNER_DISMISSED_KEY)).toBe('true');
  });
});
