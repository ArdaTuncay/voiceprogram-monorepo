import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../services/api', () => ({
  loginUser: vi.fn(),
  registerUser: vi.fn(),
  loginWithTwoFactor: vi.fn(),
  resendVerification: vi.fn(),
  requestPasswordReset: vi.fn(),
  renewSessionToken: vi.fn(() => Promise.resolve({ data: { token: 'yeni' } })),
  logoutCurrentSession: vi.fn(() => Promise.resolve({ data: undefined })),
}));
vi.mock('../components/Chat', () => ({
  default: ({ user }: { user: { username: string } }) => <div>sohbet: {user.username}</div>,
}));

import App from '../App';
import { loginUser } from '../services/api';
import { clearStoredSession, storeToken, storeUser } from '../services/tokenStorage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  clearStoredSession();
  window.history.replaceState(null, '', '/');
});

describe('App — public home page', () => {
  it('shows the home page to a signed-out visitor at /', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Arkadaşlarınla konuş, yaz, paylaş.' })).toBeInTheDocument();
  });

  it('opens Zircle in the same tab once the home page card signs in', async () => {
    vi.mocked(loginUser).mockResolvedValue({
      data: { id: 'u1', username: 'ali', email: 'ali@example.com', token: 't' },
    });
    render(<App />);

    fireEvent.change(screen.getByLabelText('E-posta'), { target: { value: 'ali@example.com' } });
    fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: 'sifre1234' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Giriş yap ve tarayıcıda aç' }));
    });

    expect(loginUser).toHaveBeenCalledWith('ali@example.com', 'sifre1234');
    expect(screen.getByText('sohbet: ali')).toBeInTheDocument();
  });

  it('goes straight to Zircle when already signed in', () => {
    storeToken('oturum');
    storeUser({ id: 'u1', username: 'ali', email: 'ali@example.com' });
    render(<App />);
    expect(screen.getByText('sohbet: ali')).toBeInTheDocument();
  });

  it("keeps the app's own sign-in screen on any other signed-out path", () => {
    window.history.replaceState(null, '', '/baska-bir-yol');
    render(<App />);
    expect(screen.queryByRole('heading', { level: 1, name: 'Arkadaşlarınla konuş, yaz, paylaş.' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Tekrar hoş geldin!' })).toBeInTheDocument();
  });

  it('never shows the site in the desktop app', () => {
    vi.stubEnv('MODE', 'electron');
    render(<App />);
    expect(screen.queryByRole('heading', { level: 1, name: 'Arkadaşlarınla konuş, yaz, paylaş.' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Tekrar hoş geldin!' })).toBeInTheDocument();
  });
});
