import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getStoredToken } from '../services/tokenStorage';

const tokenAtLogout: (string | null)[] = [];

vi.mock('../services/api', () => ({
  renewSessionToken: vi.fn(() => Promise.resolve({ data: { token: 'yeni' } })),
  // Records which token the request went out with.
  logoutCurrentSession: vi.fn(() => {
    tokenAtLogout.push(getStoredToken());
    return Promise.resolve({ data: undefined });
  }),
}));
vi.mock('../components/Chat', () => ({
  default: ({ onLogout }: { onLogout: () => void }) => <button onClick={onLogout}>çıkış</button>,
}));
vi.mock('../components/Auth', () => ({ default: () => <div>giriş</div> }));

import App from '../App';
import { logoutCurrentSession } from '../services/api';
import { clearStoredSession, storeToken, storeUser } from '../services/tokenStorage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  clearStoredSession();
  tokenAtLogout.length = 0;
});

describe('App — çıkış', () => {
  it('ends the session on the server with the current token, then signs out here', () => {
    storeToken('oturum-belirteci');
    storeUser({ id: 'u1', username: 'ali', email: 'ali@example.com' });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'çıkış' }));

    expect(logoutCurrentSession).toHaveBeenCalledTimes(1);
    expect(tokenAtLogout).toEqual(['oturum-belirteci']);
    expect(getStoredToken()).toBeNull();
    expect(screen.getByText('giriş')).toBeInTheDocument();
  });
});
