import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Auth from '../Auth';

vi.mock('../../services/api', () => ({
  registerUser: vi.fn(),
  loginUser: vi.fn(),
  resendVerification: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

import { requestPasswordReset } from '../../services/api';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Şifremi unuttum', () => {
  it('opens from the login screen, carrying over the typed email, and requests a link', async () => {
    vi.mocked(requestPasswordReset).mockResolvedValue({ data: { message: 'generic' } });
    render(<Auth onAuth={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ali@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Şifremi unuttum' }));

    const input = screen.getByLabelText('E-posta') as HTMLInputElement;
    expect(input.value).toBe('ali@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Sıfırlama bağlantısı gönder' }));

    expect(await screen.findByText(/adresi kayıtlıysa/)).not.toBeNull();
    expect(requestPasswordReset).toHaveBeenCalledWith('ali@example.com');
  });

  it('can go back to the login form', () => {
    render(<Auth onAuth={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Şifremi unuttum' }));
    fireEvent.click(screen.getByRole('button', { name: 'Giriş ekranına dön' }));

    expect(screen.getByRole('button', { name: 'Şifremi unuttum' })).not.toBeNull();
  });

  it('shows an error when the request itself fails', async () => {
    vi.mocked(requestPasswordReset).mockResolvedValue({ error: 'Network error' });
    render(<Auth onAuth={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Şifremi unuttum' }));
    fireEvent.change(screen.getByLabelText('E-posta'), { target: { value: 'ali@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sıfırlama bağlantısı gönder' }));

    expect((await screen.findByRole('alert')).textContent).toContain('İstek gönderilemedi');
  });
});
