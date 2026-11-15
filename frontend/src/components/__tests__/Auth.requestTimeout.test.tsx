import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Auth from '../Auth';
import { AUTH_REQUEST_TIMEOUT_MS } from '../../services/api';
import { AUTH_REQUEST_ERRORS } from '../../utils/errorMessages';

// Kept apart from Auth.test.tsx on purpose: that file mocks services/api
// wholesale, while this one needs the real api.ts (only `fetch` is stubbed)
// to prove the reported symptom itself — PROJECT_ARCHITECTURE.md §7 #15,
// the button stuck on "Lütfen bekle…" with no error — can't happen anymore
// end to end, not just that each layer behaves on its own.

function submitButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) throw new Error('submit button not found');
  return button;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  // A request that never gets any response at all, and ignores the abort.
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Auth — a login request that never settles', () => {
  it('stays on "Lütfen bekle…" until the deadline, then re-enables the button and shows the timeout error', async () => {
    const onAuth = vi.fn();
    render(<Auth onAuth={onAuth} />);

    fireEvent.change(screen.getByLabelText('E-posta'), { target: { value: 'ard@example.com' } });
    fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: 'password123' } });
    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toBe('Lütfen bekle…');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
    });

    expect(submitButton().disabled).toBe(false);
    expect(submitButton().textContent).toBe('Giriş yap');
    expect(screen.getByText(AUTH_REQUEST_ERRORS.timeout)).not.toBeNull();
    expect(onAuth).not.toHaveBeenCalled();
  });
});
