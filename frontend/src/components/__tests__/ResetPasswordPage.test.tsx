import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResetPasswordPage from '../ResetPasswordPage';

vi.mock('../../services/api', () => ({
  confirmPasswordReset: vi.fn(),
}));

import { confirmPasswordReset } from '../../services/api';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fillAndSubmit(password: string, confirmation = password) {
  fireEvent.change(screen.getByLabelText('Yeni şifre'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Yeni şifre (tekrar)'), { target: { value: confirmation } });
  fireEvent.click(screen.getByRole('button', { name: 'Şifreyi güncelle' }));
}

describe('ResetPasswordPage', () => {
  it('sends the token from the link together with the new password', async () => {
    vi.mocked(confirmPasswordReset).mockResolvedValue({ data: { message: 'ok' } });
    render(<ResetPasswordPage token="link-token" />);

    fillAndSubmit('yepyeni-parola');

    await waitFor(() => expect(confirmPasswordReset).toHaveBeenCalledWith('link-token', 'yepyeni-parola'));
    expect(await screen.findByText('Şifreniz güncellendi')).not.toBeNull();
  });

  it('refuses mismatched passwords without calling the backend', () => {
    render(<ResetPasswordPage token="t" />);

    fillAndSubmit('yepyeni-parola', 'baska-parola');

    expect(screen.getByRole('alert').textContent).toBe('Şifreler eşleşmiyor.');
    expect(confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('refuses a password shorter than 8 characters without calling the backend', () => {
    render(<ResetPasswordPage token="t" />);

    fillAndSubmit('kisa');

    expect(screen.getByRole('alert').textContent).toContain('en az 8');
    expect(confirmPasswordReset).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_token', 'Bağlantı geçersiz'],
    ['token_expired', 'Bağlantının süresi dolmuş'],
  ])('explains a %s link instead of showing the raw code', async (code, title) => {
    vi.mocked(confirmPasswordReset).mockResolvedValue({ error: code });
    render(<ResetPasswordPage token="t" />);

    fillAndSubmit('yepyeni-parola');

    expect(await screen.findByText(title)).not.toBeNull();
    expect(screen.queryByText(code)).toBeNull();
  });

  it('shows a generic error and keeps the form for any other failure', async () => {
    vi.mocked(confirmPasswordReset).mockResolvedValue({ error: 'Network error' });
    render(<ResetPasswordPage token="t" />);

    fillAndSubmit('yepyeni-parola');

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Şifre güncellenemedi, lütfen tekrar deneyin.'
    );
    expect(screen.getByLabelText('Yeni şifre')).not.toBeNull();
  });
});
