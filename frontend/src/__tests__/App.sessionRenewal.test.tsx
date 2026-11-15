import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

vi.mock('../services/api', () => ({
  renewSessionToken: vi.fn(() => Promise.resolve({ data: { token: 'yeni' } })),
}));
vi.mock('../components/Chat', () => ({ default: () => <div>chat</div> }));
vi.mock('../components/Auth', () => ({ default: () => <div>giriş</div> }));

import App, { SESSION_RENEW_INTERVAL_MS } from '../App';
import { renewSessionToken } from '../services/api';
import { clearStoredSession, storeToken, storeUser } from '../services/tokenStorage';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  clearStoredSession();
});

describe('App — oturum yenileme', () => {
  it('renews the token on start and every 12 hours while signed in', () => {
    storeToken('eski');
    storeUser({ id: 'u1', username: 'ali', email: 'ali@example.com' });

    render(<App />);
    expect(renewSessionToken).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(SESSION_RENEW_INTERVAL_MS);
    });
    expect(renewSessionToken).toHaveBeenCalledTimes(2);
  });

  it('does nothing while signed out', () => {
    render(<App />);

    act(() => {
      vi.advanceTimersByTime(SESSION_RENEW_INTERVAL_MS * 2);
    });
    expect(renewSessionToken).not.toHaveBeenCalled();
  });
});
