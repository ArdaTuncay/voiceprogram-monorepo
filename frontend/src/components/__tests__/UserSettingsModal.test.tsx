import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import UserSettingsModal from '../UserSettingsModal';
import { THEME_STORAGE_KEY } from '../../services/theme';
import type { User } from '../../types';

vi.mock('../../services/api', () => ({
  updateUsername: vi.fn(),
  updateEmail: vi.fn(),
  updatePassword: vi.fn(),
  updateFriendRequestPrivacy: vi.fn(),
  fetchBlockedUsers: vi.fn().mockResolvedValue({ data: [] }),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock('../../services/socket', () => ({
  disconnectSocket: vi.fn(),
}));

vi.mock('../../services/session', () => ({
  forceLogout: vi.fn(),
}));

import {
  deleteAccount,
  fetchBlockedUsers,
  unblockUser,
  updateEmail,
  updateFriendRequestPrivacy,
  updatePassword,
  updateUsername,
} from '../../services/api';
import { disconnectSocket } from '../../services/socket';
import { forceLogout } from '../../services/session';
import { useFriendStore } from '../../stores/useFriendStore';

const testUser: User = { id: 'u1', username: 'ardatuncay', email: 'arda@example.com' };

function mockSystemPreference(prefersLight: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: light)' && prefersLight,
    media: query,
  })) as unknown as typeof window.matchMedia;
}

describe('UserSettingsModal', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockSystemPreference(false);
    vi.clearAllMocks();
    useFriendStore.getState().reset();
    vi.mocked(fetchBlockedUsers).mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('opens on "Görünüm" by default with the theme selector visible', () => {
    render(<UserSettingsModal user={testUser} onClose={vi.fn()} />);

    expect(screen.getAllByText('Görünüm').length).toBeGreaterThan(0);
    expect(screen.getByRole('radiogroup', { name: 'Tema' })).not.toBeNull();
  });

  it('closes via the X button', () => {
    const onClose = vi.fn();
    render(<UserSettingsModal user={testUser} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<UserSettingsModal user={testUser} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches categories, e.g. to "Hesap Silme / Veri Yönetimi"', () => {
    render(<UserSettingsModal user={testUser} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hesap Silme / Veri Yönetimi' }));

    expect(screen.getByRole('heading', { name: 'Hesap Silme / Veri Yönetimi' })).not.toBeNull();
    // The theme selector only renders for the Appearance category.
    expect(screen.queryByRole('radiogroup', { name: 'Tema' })).toBeNull();
  });

  it('still switches back to "Görünüm" and finds the theme selector again', () => {
    render(<UserSettingsModal user={testUser} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Klavye Kısayolları' }));
    fireEvent.click(screen.getByRole('button', { name: 'Görünüm' }));

    expect(screen.getByRole('radiogroup', { name: 'Tema' })).not.toBeNull();
  });

  it('selecting a theme option persists it and applies data-theme — the same mechanism the old toggle used', () => {
    render(<UserSettingsModal user={testUser} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Açık' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(screen.getByRole('radio', { name: 'Açık' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Koyu' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('selecting "Sistem" clears the stored override and resolves via the OS preference', () => {
    mockSystemPreference(true);
    render(<UserSettingsModal user={testUser} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Koyu' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Sistem' }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('preselects the radio matching whatever preference was already stored', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');

    render(<UserSettingsModal user={testUser} onClose={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'Açık' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Koyu' }).getAttribute('aria-checked')).toBe('false');
  });

  describe('Hesabım', () => {
    function openAccountTab() {
      render(<UserSettingsModal user={testUser} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Hesabım' }));
    }

    it('prefills the username and email fields with the current values', () => {
      openAccountTab();

      expect(screen.getByLabelText('Yeni kullanıcı adı')).toHaveValue(testUser.username);
      expect(screen.getByLabelText('Yeni e-posta')).toHaveValue(testUser.email);
    });

    it('submits the username form to updateUsername with the trimmed value and current password', async () => {
      vi.mocked(updateUsername).mockResolvedValue({ data: { ...testUser, username: 'renamed' } });
      openAccountTab();

      fireEvent.change(screen.getByLabelText('Yeni kullanıcı adı'), {
        target: { value: '  renamed  ' },
      });
      fireEvent.change(screen.getByLabelText('Mevcut şifre', { selector: '#account-username-password' }), {
        target: { value: 'my-password' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Kullanıcı Adını Değiştir' }));
      });

      expect(updateUsername).toHaveBeenCalledWith('renamed', 'my-password');
      expect(screen.getByText('Kullanıcı adın güncellendi.')).not.toBeNull();
    });

    it('shows the backend error message when the username update fails', async () => {
      vi.mocked(updateUsername).mockResolvedValue({ error: 'username has already been taken' });
      openAccountTab();

      fireEvent.change(screen.getByLabelText('Yeni kullanıcı adı'), {
        target: { value: 'taken_name' },
      });
      fireEvent.change(screen.getByLabelText('Mevcut şifre', { selector: '#account-username-password' }), {
        target: { value: 'my-password' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Kullanıcı Adını Değiştir' }));
      });

      expect(screen.getByText('username has already been taken')).not.toBeNull();
    });

    it('submits the email form to updateEmail with the trimmed value and current password', async () => {
      vi.mocked(updateEmail).mockResolvedValue({ data: { ...testUser, email: 'new@example.com' } });
      openAccountTab();

      fireEvent.change(screen.getByLabelText('Yeni e-posta'), {
        target: { value: '  new@example.com  ' },
      });
      fireEvent.change(screen.getByLabelText('Mevcut şifre', { selector: '#account-email-password' }), {
        target: { value: 'my-password' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'E-postayı Değiştir' }));
      });

      expect(updateEmail).toHaveBeenCalledWith('new@example.com', 'my-password');
      expect(screen.getByText('E-posta adresin güncellendi.')).not.toBeNull();
    });

    it('rejects a password change locally when the confirmation does not match, without calling the API', async () => {
      openAccountTab();

      fireEvent.change(screen.getByLabelText('Mevcut şifre', { selector: '#account-password-current' }), {
        target: { value: 'old-pass' },
      });
      fireEvent.change(screen.getByLabelText('Yeni şifre'), { target: { value: 'new-pass-1' } });
      fireEvent.change(screen.getByLabelText('Yeni şifre (tekrar)'), { target: { value: 'new-pass-2' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }));
      });

      expect(screen.getByText('Yeni şifreler eşleşmiyor.')).not.toBeNull();
      expect(updatePassword).not.toHaveBeenCalled();
    });

    it('on a successful password change, shows the session-ended message and force-logs-out shortly after', async () => {
      vi.useFakeTimers();
      vi.mocked(updatePassword).mockResolvedValue({ data: testUser });
      openAccountTab();

      fireEvent.change(screen.getByLabelText('Mevcut şifre', { selector: '#account-password-current' }), {
        target: { value: 'old-pass' },
      });
      fireEvent.change(screen.getByLabelText('Yeni şifre'), { target: { value: 'new-pass-123' } });
      fireEvent.change(screen.getByLabelText('Yeni şifre (tekrar)'), { target: { value: 'new-pass-123' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }));
      });

      expect(updatePassword).toHaveBeenCalledWith('old-pass', 'new-pass-123');
      expect(screen.getByText(/Diğer tüm cihazlarda/)).not.toBeNull();
      expect(forceLogout).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(disconnectSocket).toHaveBeenCalledTimes(1);
      expect(forceLogout).toHaveBeenCalledTimes(1);
    });

    it('shows the backend error message when the current password is wrong', async () => {
      vi.mocked(updatePassword).mockResolvedValue({ error: 'Mevcut şifre yanlış' });
      openAccountTab();

      fireEvent.change(screen.getByLabelText('Mevcut şifre', { selector: '#account-password-current' }), {
        target: { value: 'wrong' },
      });
      fireEvent.change(screen.getByLabelText('Yeni şifre'), { target: { value: 'new-pass-123' } });
      fireEvent.change(screen.getByLabelText('Yeni şifre (tekrar)'), { target: { value: 'new-pass-123' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Şifreyi Değiştir' }));
      });

      expect(screen.getByText('Mevcut şifre yanlış')).not.toBeNull();
      expect(forceLogout).not.toHaveBeenCalled();
    });
  });

  describe('Bildirimler', () => {
    function openNotificationsTab() {
      render(<UserSettingsModal user={testUser} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Bildirimler' }));
    }

    it('defaults to enabled + desktop on, sound + mentions-only off', () => {
      openNotificationsTab();

      expect(screen.getByLabelText('Bildirimleri etkinleştir')).toHaveProperty('checked', true);
      expect(screen.getByLabelText('Masaüstü bildirimleri')).toHaveProperty('checked', true);
      expect(screen.getByLabelText('Ses bildirimleri')).toHaveProperty('checked', false);
      expect(screen.getByLabelText('Sadece bahsedilmelerde bildir')).toHaveProperty('checked', false);
    });

    it('disables the three sub-toggles when the master switch is off', () => {
      openNotificationsTab();

      fireEvent.click(screen.getByLabelText('Bildirimleri etkinleştir'));

      expect(screen.getByLabelText('Ses bildirimleri')).toHaveProperty('disabled', true);
      expect(screen.getByLabelText('Masaüstü bildirimleri')).toHaveProperty('disabled', true);
      expect(screen.getByLabelText('Sadece bahsedilmelerde bildir')).toHaveProperty('disabled', true);
    });

    it('persists a toggle flip to localStorage', () => {
      openNotificationsTab();

      fireEvent.click(screen.getByLabelText('Sadece bahsedilmelerde bildir'));

      const stored = JSON.parse(localStorage.getItem('zircle-notification-prefs')!);
      expect(stored.mentionsOnly).toBe(true);
      expect(stored.enabled).toBe(true);
    });

    it('requests browser permission when turning desktop notifications on, and reverts with a note if denied', async () => {
      const requestPermission = vi.fn().mockResolvedValue('denied');
      // jsdom has no Notification global by default.
      vi.stubGlobal('Notification', { permission: 'default', requestPermission });
      localStorage.setItem(
        'zircle-notification-prefs',
        JSON.stringify({ enabled: true, sound: false, desktop: false, mentionsOnly: false })
      );

      openNotificationsTab();
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Masaüstü bildirimleri'));
      });

      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Tarayıcı bildirim izni reddedildi/)).not.toBeNull();
      expect(screen.getByLabelText('Masaüstü bildirimleri')).toHaveProperty('checked', false);

      vi.unstubAllGlobals();
    });
  });

  describe('Klavye Kısayolları', () => {
    it('renders the static shortcuts list', () => {
      render(<UserSettingsModal user={testUser} onClose={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Klavye Kısayolları' }));

      expect(screen.getByRole('heading', { name: 'Klavye Kısayolları' })).not.toBeNull();
      expect(screen.getByText('Mesaj gönder / mesaj düzenlemeyi kaydet')).not.toBeNull();
      expect(screen.getByText('Yeni satır')).not.toBeNull();
      expect(screen.getAllByText('Enter').length).toBeGreaterThan(0);
      expect(screen.getByText('Esc')).not.toBeNull();
    });
  });

  describe('Gizlilik & Güvenlik', () => {
    function openPrivacyTab(user: User = testUser) {
      render(<UserSettingsModal user={user} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Gizlilik & Güvenlik' }));
    }

    it('defaults the segmented control to "Herkes" when the user has no stored preference', () => {
      openPrivacyTab();

      expect(screen.getByRole('radio', { name: 'Herkes' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('radio', { name: 'Kimse' }).getAttribute('aria-checked')).toBe('false');
    });

    it('preselects "Kimse" when the user already has friend_request_privacy: "nobody"', () => {
      openPrivacyTab({ ...testUser, friend_request_privacy: 'nobody' });

      expect(screen.getByRole('radio', { name: 'Kimse' }).getAttribute('aria-checked')).toBe('true');
    });

    it('selecting an option calls updateFriendRequestPrivacy and updates the selection', async () => {
      vi.mocked(updateFriendRequestPrivacy).mockResolvedValue({
        data: { friend_request_privacy: 'nobody' },
      });
      openPrivacyTab();

      await act(async () => {
        fireEvent.click(screen.getByRole('radio', { name: 'Kimse' }));
      });

      expect(updateFriendRequestPrivacy).toHaveBeenCalledWith('nobody');
      expect(screen.getByRole('radio', { name: 'Kimse' }).getAttribute('aria-checked')).toBe('true');
    });

    it('shows "Kimseyi engellemedin." when the blocked list is empty', async () => {
      openPrivacyTab();

      await screen.findByText('Kimseyi engellemedin.');
    });

    it('lists blocked users and removes one on "Engeli Kaldır"', async () => {
      vi.mocked(fetchBlockedUsers).mockResolvedValue({
        data: [{ user_id: 'u9', username: 'blocked_guy' }],
      });
      vi.mocked(unblockUser).mockResolvedValue({ data: undefined });
      openPrivacyTab();

      await screen.findByText('blocked_guy');

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Engeli Kaldır' }));
      });

      expect(unblockUser).toHaveBeenCalledWith('u9');
      expect(screen.queryByText('blocked_guy')).toBeNull();
      expect(screen.getByText('Kimseyi engellemedin.')).not.toBeNull();
    });

    it('shows the backend error when unblocking fails', async () => {
      vi.mocked(fetchBlockedUsers).mockResolvedValue({
        data: [{ user_id: 'u9', username: 'blocked_guy' }],
      });
      vi.mocked(unblockUser).mockResolvedValue({ error: 'Bu kullanıcıyı engellemediniz' });
      openPrivacyTab();

      await screen.findByText('blocked_guy');

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Engeli Kaldır' }));
      });

      expect(screen.getByText('Bu kullanıcıyı engellemediniz')).not.toBeNull();
    });
  });

  describe('Hesap Silme / Veri Yönetimi', () => {
    function openDeleteTab() {
      render(<UserSettingsModal user={testUser} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Hesap Silme / Veri Yönetimi' }));
    }

    function fillValidForm() {
      fireEvent.change(screen.getByLabelText('Mevcut şifre'), { target: { value: 'my-password' } });
      fireEvent.click(screen.getByLabelText(/Bu işlemin geri alınamaz olduğunu anlıyorum/));
      fireEvent.change(screen.getByLabelText(/Onaylamak için/), {
        target: { value: 'HESABIMI SİL' },
      });
    }

    it('keeps the submit button disabled until password, checkbox, and exact confirmation phrase are all set', () => {
      openDeleteTab();

      const button = screen.getByRole('button', { name: 'Hesabımı Sil' });
      expect(button).toHaveProperty('disabled', true);

      fireEvent.change(screen.getByLabelText('Mevcut şifre'), { target: { value: 'my-password' } });
      expect(button).toHaveProperty('disabled', true);

      fireEvent.click(screen.getByLabelText(/Bu işlemin geri alınamaz olduğunu anlıyorum/));
      expect(button).toHaveProperty('disabled', true);

      fireEvent.change(screen.getByLabelText(/Onaylamak için/), { target: { value: 'wrong phrase' } });
      expect(button).toHaveProperty('disabled', true);

      fireEvent.change(screen.getByLabelText(/Onaylamak için/), {
        target: { value: 'HESABIMI SİL' },
      });
      expect(button).toHaveProperty('disabled', false);
    });

    it('on success, calls deleteAccount and force-logs-out shortly after', async () => {
      vi.useFakeTimers();
      vi.mocked(deleteAccount).mockResolvedValue({ data: undefined });
      openDeleteTab();
      fillValidForm();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Hesabımı Sil' }));
      });

      expect(deleteAccount).toHaveBeenCalledWith('my-password');
      expect(screen.getByText(/Hesabın silindi/)).not.toBeNull();
      expect(forceLogout).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(disconnectSocket).toHaveBeenCalledTimes(1);
      expect(forceLogout).toHaveBeenCalledTimes(1);
    });

    it('shows the backend error message when the current password is wrong, without logging out', async () => {
      vi.mocked(deleteAccount).mockResolvedValue({ error: 'Mevcut şifre yanlış' });
      openDeleteTab();
      fillValidForm();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Hesabımı Sil' }));
      });

      expect(screen.getByText('Mevcut şifre yanlış')).not.toBeNull();
      expect(forceLogout).not.toHaveBeenCalled();
    });
  });
});
