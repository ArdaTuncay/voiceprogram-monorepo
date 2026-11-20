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
  previewInvite: vi.fn(() => new Promise(() => {})),
  acceptInvite: vi.fn(),
  fetchServers: vi.fn(() => Promise.resolve({ data: [] })),
  fetchServerChannels: vi.fn(() => Promise.resolve({ data: [] })),
}));
vi.mock('../components/Chat', () => ({
  default: ({ user }: { user: { username: string } }) => <div>sohbet: {user.username}</div>,
}));

import App from '../App';
import { acceptInvite, loginUser } from '../services/api';
import { clearStoredSession, storeToken, storeUser } from '../services/tokenStorage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  clearStoredSession();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

function signInAs(username: string) {
  storeToken('oturum');
  storeUser({ id: 'u1', username, email: `${username}@example.com` });
}

function h1(name: string) {
  return screen.queryByRole('heading', { level: 1, name });
}

async function submitSignIn() {
  fireEvent.change(screen.getByLabelText('E-posta'), { target: { value: 'ali@example.com' } });
  fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: 'sifre1234' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Giriş yap ve tarayıcıda aç' }));
  });
}

describe('App — public website', () => {
  it('shows the home page to a signed-out visitor at /', () => {
    render(<App />);
    expect(h1('Arkadaşlarınla konuş, yaz, paylaş.')).toBeInTheDocument();
  });

  it('opens Zircle in the same tab once the home page card signs in', async () => {
    vi.mocked(loginUser).mockResolvedValue({
      data: { id: 'u1', username: 'ali', email: 'ali@example.com', token: 't' },
    });
    render(<App />);

    await submitSignIn();

    expect(loginUser).toHaveBeenCalledWith('ali@example.com', 'sifre1234');
    expect(screen.getByText('sohbet: ali')).toBeInTheDocument();
  });

  it('goes straight to Zircle when already signed in', () => {
    signInAs('ali');
    render(<App />);
    expect(screen.getByText('sohbet: ali')).toBeInTheDocument();
  });

  it.each([
    ['/ozellikler', 'Sohbet için gereken her şey.'],
    ['/indir', "Zircle'ı bilgisayarına kur."],
    ['/guvenlik', 'Hesabına kimin girdiğini sen bilirsin.'],
    ['/destek', 'Nasıl yardımcı olabiliriz?'],
    ['/yenilikler', "Zircle'da neler değişti?"],
    ['/gizlilik', 'Gizlilik Politikası'],
    ['/kosullar', 'Kullanım Koşulları'],
  ])('shows %s signed out and signed in', (path, title) => {
    window.history.replaceState(null, '', path);
    render(<App />);
    expect(h1(title)).toBeInTheDocument();
    cleanup();

    signInAs('ali');
    render(<App />);
    expect(h1(title)).toBeInTheDocument();
    expect(screen.queryByText('sohbet: ali')).toBeNull();
  });

  it('shows the sign-in page at /giris, and Zircle there once signed in', () => {
    window.history.replaceState(null, '', '/giris');
    render(<App />);
    expect(h1('Tekrar hoş geldin!')).toBeInTheDocument();
    cleanup();

    signInAs('ali');
    render(<App />);
    expect(screen.getByText('sohbet: ali')).toBeInTheDocument();
  });

  it('opens /giris#kayit on sign-up', () => {
    window.history.replaceState(null, '', '/giris#kayit');
    render(<App />);
    expect(h1('Hesap oluştur')).toBeInTheDocument();
  });

  it('moves the address to / after signing in on /giris', async () => {
    vi.mocked(loginUser).mockResolvedValue({
      data: { id: 'u1', username: 'ali', email: 'ali@example.com', token: 't' },
    });
    window.history.replaceState(null, '', '/giris');
    render(<App />);

    await submitSignIn();

    expect(window.location.pathname).toBe('/');
    expect(screen.getByText('sohbet: ali')).toBeInTheDocument();
  });

  it('joins the invite the visitor picked before signing in', async () => {
    vi.mocked(loginUser).mockResolvedValue({
      data: { id: 'u1', username: 'ali', email: 'ali@example.com', token: 't' },
    });
    vi.mocked(acceptInvite).mockResolvedValue({ data: { id: 's1', name: 'Oyun Gecesi', owner_id: 'u2' } });
    sessionStorage.setItem('zircle.pendingInvite', 'abc123');
    window.history.replaceState(null, '', '/giris');
    render(<App />);

    await submitSignIn();

    expect(acceptInvite).toHaveBeenCalledWith('abc123');
    expect(sessionStorage.getItem('zircle.pendingInvite')).toBeNull();
  });

  it('shows the invite page at /davet/<code>', () => {
    window.history.replaceState(null, '', '/davet/abc123');
    render(<App />);
    expect(screen.getByText('Davet yükleniyor…')).toBeInTheDocument();
  });

  it('shows the 404 page on an unknown address while signed out', () => {
    window.history.replaceState(null, '', '/baska-bir-yol');
    render(<App />);
    expect(h1('Burada kimse yok.')).toBeInTheDocument();
  });

  it('opens Zircle on an unknown address while signed in', () => {
    signInAs('ali');
    window.history.replaceState(null, '', '/baska-bir-yol');
    render(<App />);
    expect(screen.getByText('sohbet: ali')).toBeInTheDocument();
  });

  it('never shows the site in the desktop app', () => {
    vi.stubEnv('MODE', 'electron');
    for (const path of ['/', '/ozellikler', '/giris', '/baska-bir-yol']) {
      window.history.replaceState(null, '', path);
      render(<App />);
      expect(screen.getByRole('heading', { name: 'Tekrar hoş geldin!' })).toBeInTheDocument();
      expect(document.querySelector('.site')).toBeNull();
      cleanup();
    }
  });
});
