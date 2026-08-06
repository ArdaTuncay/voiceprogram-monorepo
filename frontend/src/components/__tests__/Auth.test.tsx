import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Auth from '../Auth';

vi.mock('../../services/api', () => ({
  registerUser: vi.fn(),
  loginUser: vi.fn(),
  resendVerification: vi.fn(),
}));

import { registerUser, loginUser, resendVerification } from '../../services/api';

function fillAndSubmit(fields: { username?: string; email: string; password: string }) {
  if (fields.username !== undefined) {
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: fields.username } });
  }
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: fields.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: fields.password } });
  // Not screen.getByRole('button', { name: ... }) — the submit button's own
  // label ("Continue"/"Log In") collides with the mode-toggle button's label
  // ("Log In"/"Register") depending on which mode is active, so this
  // targets the form's submit button by type instead of by text.
  return act(async () => {
    const submitButton = document.querySelector('button[type="submit"]');
    if (!submitButton) throw new Error('submit button not found');
    fireEvent.click(submitButton);
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Auth — register', () => {
  it('shows the "check your email" screen instead of logging in, on success', async () => {
    vi.mocked(registerUser).mockResolvedValue({
      data: {
        message: 'Kayıt başarılı, lütfen e-postanızı kontrol edip hesabınızı doğrulayın',
        email_verification_required: true,
      },
    });
    const onAuth = vi.fn();

    render(<Auth onAuth={onAuth} />);
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await fillAndSubmit({
      username: 'newperson',
      email: 'newperson@example.com',
      password: 'password123',
    });

    expect(onAuth).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('E-postanızı kontrol edin')).not.toBeNull();
    });
    expect(screen.getByText('newperson@example.com')).not.toBeNull();
  });

  it('shows the changeset error and stays on the form when registration fails', async () => {
    vi.mocked(registerUser).mockResolvedValue({ error: 'email has already been taken' });
    const onAuth = vi.fn();

    render(<Auth onAuth={onAuth} />);
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await fillAndSubmit({
      username: 'newperson',
      email: 'taken@example.com',
      password: 'password123',
    });

    expect(screen.getByText('email has already been taken')).not.toBeNull();
    expect(onAuth).not.toHaveBeenCalled();
    // Still the registration form, not the "check your email" screen.
    expect(screen.queryByText('E-postanızı kontrol edin')).toBeNull();
  });
});

describe('Auth — login', () => {
  it('logs in and calls onAuth on success', async () => {
    vi.mocked(loginUser).mockResolvedValue({
      data: { id: 'u1', username: 'ard', email: 'ard@example.com', token: 'tok123' },
    });
    const onAuth = vi.fn();

    render(<Auth onAuth={onAuth} />);
    await fillAndSubmit({ email: 'ard@example.com', password: 'password123' });

    expect(onAuth).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', username: 'ard', email: 'ard@example.com' })
    );
  });

  it('shows a plain wrong-credentials error as-is', async () => {
    vi.mocked(loginUser).mockResolvedValue({ error: 'Invalid email or password' });
    const onAuth = vi.fn();

    render(<Auth onAuth={onAuth} />);
    await fillAndSubmit({ email: 'ard@example.com', password: 'wrong' });

    expect(screen.getByText('Invalid email or password')).not.toBeNull();
    expect(onAuth).not.toHaveBeenCalled();
  });

  it('shows the "check your email" screen (not the raw error code) for an unverified account', async () => {
    vi.mocked(loginUser).mockResolvedValue({ error: 'email_not_verified' });
    const onAuth = vi.fn();

    render(<Auth onAuth={onAuth} />);
    await fillAndSubmit({ email: 'unverified@example.com', password: 'password123' });

    expect(onAuth).not.toHaveBeenCalled();
    expect(screen.queryByText('email_not_verified')).toBeNull();
    await waitFor(() => {
      expect(screen.getByText('E-postanızı kontrol edin')).not.toBeNull();
    });
    expect(screen.getByText('unverified@example.com')).not.toBeNull();
  });
});

describe('Auth — verification pending screen', () => {
  async function getToPendingScreen() {
    vi.mocked(loginUser).mockResolvedValue({ error: 'email_not_verified' });
    render(<Auth onAuth={vi.fn()} />);
    await fillAndSubmit({ email: 'unverified@example.com', password: 'password123' });
    await waitFor(() => {
      expect(screen.getByText('E-postanızı kontrol edin')).not.toBeNull();
    });
  }

  it('resends the verification email and shows a success message', async () => {
    vi.mocked(resendVerification).mockResolvedValue({
      data: { message: 'E-posta adresiniz sistemde kayıtlıysa, doğrulama bağlantısı gönderildi' },
    });
    await getToPendingScreen();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tekrar gönder' }));
    });

    expect(resendVerification).toHaveBeenCalledWith('unverified@example.com');
    expect(screen.getByText('Doğrulama e-postası tekrar gönderildi.')).not.toBeNull();
  });

  it('shows an error message if the resend request fails', async () => {
    vi.mocked(resendVerification).mockResolvedValue({ error: 'Network error' });
    await getToPendingScreen();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tekrar gönder' }));
    });

    expect(screen.getByText('Mail gönderilemedi, lütfen tekrar deneyin.')).not.toBeNull();
  });

  it('returns to the login form via "Giriş ekranına dön"', async () => {
    await getToPendingScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Giriş ekranına dön' }));

    expect(screen.getByRole('button', { name: 'Log In' })).not.toBeNull();
    expect(screen.queryByText('E-postanızı kontrol edin')).toBeNull();
  });
});
