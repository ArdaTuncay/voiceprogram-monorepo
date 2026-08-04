import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import VerifyEmailPage from '../VerifyEmailPage';

vi.mock('../../services/api', () => ({
  verifyEmail: vi.fn(),
}));

import { verifyEmail } from '../../services/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VerifyEmailPage', () => {
  it('shows a loading state before the request resolves', () => {
    vi.mocked(verifyEmail).mockReturnValue(new Promise(() => {})); // never resolves

    render(<VerifyEmailPage token="sometoken" />);

    expect(screen.getByText('Doğrulanıyor…')).not.toBeNull();
  });

  it('calls GET /api/verify-email/:token with the given token', () => {
    vi.mocked(verifyEmail).mockReturnValue(new Promise(() => {}));

    render(<VerifyEmailPage token="my-token-123" />);

    expect(verifyEmail).toHaveBeenCalledWith('my-token-123');
  });

  it('shows success copy and a working "Giriş yap" button on a valid token', async () => {
    vi.mocked(verifyEmail).mockResolvedValue({ data: { message: 'E-posta doğrulandı' } });

    await act(async () => {
      render(<VerifyEmailPage token="valid-token" />);
    });

    await waitFor(() => {
      expect(screen.getByText('E-postanız doğrulandı!')).not.toBeNull();
    });

    const button = screen.getByRole('button', { name: 'Giriş yap' });
    expect(() => fireEvent.click(button)).not.toThrow();
  });

  it('shows a friendly message for an unknown token, not the raw error code', async () => {
    vi.mocked(verifyEmail).mockResolvedValue({ error: 'invalid_token' });

    await act(async () => {
      render(<VerifyEmailPage token="does-not-exist" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Bağlantı geçersiz')).not.toBeNull();
    });

    expect(screen.queryByText('invalid_token')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Giriş yap' })).toBeNull();
  });

  it('shows a friendly message for an expired token, not the raw error code', async () => {
    vi.mocked(verifyEmail).mockResolvedValue({ error: 'token_expired' });

    await act(async () => {
      render(<VerifyEmailPage token="expired-token" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Bağlantının süresi dolmuş')).not.toBeNull();
    });

    expect(screen.queryByText('token_expired')).toBeNull();
  });

  it('falls back to a generic error message for anything else (e.g. a network error)', async () => {
    vi.mocked(verifyEmail).mockResolvedValue({
      error: 'Network error — is the backend running on port 4000?',
    });

    await act(async () => {
      render(<VerifyEmailPage token="whatever" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Bir şeyler ters gitti')).not.toBeNull();
    });
  });
});
