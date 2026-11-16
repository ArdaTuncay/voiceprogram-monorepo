import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Auth from '../Auth';

vi.mock('../../services/api', () => ({
  registerUser: vi.fn(),
  loginUser: vi.fn(),
  loginWithTwoFactor: vi.fn(),
  resendVerification: vi.fn(),
}));

import { registerUser, loginUser, loginWithTwoFactor, resendVerification } from '../../services/api';
import { AUTH_REQUEST_ERRORS } from '../../utils/errorMessages';

function fillAndSubmit(fields: { username?: string; email: string; password: string }) {
  if (fields.username !== undefined) {
    fireEvent.change(screen.getByLabelText('Kullanıcı adı'), { target: { value: fields.username } });
  }
  fireEvent.change(screen.getByLabelText('E-posta'), { target: { value: fields.email } });
  fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: fields.password } });
  // Not screen.getByRole('button', { name: ... }) — the submit button's own
  // label ("Devam et"/"Giriş yap") collides with the mode-toggle button's label
  // ("Giriş yap"/"Kayıt ol") depending on which mode is active, so this
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
    fireEvent.click(screen.getByRole('button', { name: 'Kayıt ol' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Kayıt ol' }));

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

// PROJECT_ARCHITECTURE.md §7 #15 — whatever the request does, the submit
// button must come back and an error must be shown. (The "request never
// settles" case is covered end to end, real api.ts included, in
// Auth.requestTimeout.test.tsx.)
describe('Auth — submit button never stays stuck', () => {
  function submitButton(): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!button) throw new Error('submit button not found');
    return button;
  }

  it('re-enables the button and shows an error if login rejects unexpectedly', async () => {
    vi.mocked(loginUser).mockRejectedValue(new Error('boom'));
    const onAuth = vi.fn();

    render(<Auth onAuth={onAuth} />);
    await fillAndSubmit({ email: 'ard@example.com', password: 'password123' });

    expect(submitButton().disabled).toBe(false);
    expect(submitButton().textContent).toBe('Giriş yap');
    expect(screen.getByText(AUTH_REQUEST_ERRORS.unexpected)).not.toBeNull();
    expect(onAuth).not.toHaveBeenCalled();
  });

  it('re-enables the button and shows an error if registration rejects unexpectedly', async () => {
    vi.mocked(registerUser).mockRejectedValue(new Error('boom'));

    render(<Auth onAuth={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kayıt ol' }));
    await fillAndSubmit({
      username: 'newperson',
      email: 'newperson@example.com',
      password: 'password123',
    });

    expect(submitButton().disabled).toBe(false);
    expect(submitButton().textContent).toBe('Devam et');
    expect(screen.getByText(AUTH_REQUEST_ERRORS.unexpected)).not.toBeNull();
  });

  it('shows the API layer\'s error message and re-enables the button on a failed login', async () => {
    vi.mocked(loginUser).mockResolvedValue({ error: AUTH_REQUEST_ERRORS.rateLimited });

    render(<Auth onAuth={vi.fn()} />);
    await fillAndSubmit({ email: 'ard@example.com', password: 'password123' });

    expect(submitButton().disabled).toBe(false);
    expect(screen.getByText(AUTH_REQUEST_ERRORS.rateLimited)).not.toBeNull();
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

    expect(screen.getByRole('button', { name: 'Giriş yap' })).not.toBeNull();
    expect(screen.queryByText('E-postanızı kontrol edin')).toBeNull();
  });
});

describe('Auth — two-factor sign-in', () => {
  const user = { id: 'u1', username: 'ali', email: 'ali@example.com', token: 'tok' };

  it('asks for the code after a correct password, then signs in with it', async () => {
    vi.mocked(loginUser).mockResolvedValue({ data: { two_factor: true, challenge: 'ch' } });
    vi.mocked(loginWithTwoFactor).mockResolvedValue({ data: user });
    const onAuth = vi.fn();
    render(<Auth onAuth={onAuth} />);

    await fillAndSubmit({ email: 'ali@example.com', password: 'password123' });

    expect(onAuth).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'İki adımlı doğrulama' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Doğrulama kodu'), { target: { value: '123 456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Doğrula' }));
    });

    expect(loginWithTwoFactor).toHaveBeenCalledWith('ch', '123456');
    expect(onAuth).toHaveBeenCalledWith(user);
  });

  it('shows the error for a wrong code and lets the user try again', async () => {
    vi.mocked(loginUser).mockResolvedValue({ data: { two_factor: true, challenge: 'ch' } });
    vi.mocked(loginWithTwoFactor).mockResolvedValue({ error: 'Kod geçersiz ya da süresi dolmuş' });
    const onAuth = vi.fn();
    render(<Auth onAuth={onAuth} />);

    await fillAndSubmit({ email: 'ali@example.com', password: 'password123' });
    fireEvent.change(screen.getByLabelText('Doğrulama kodu'), { target: { value: '000000' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Doğrula' }));
    });

    expect(screen.getByText('Kod geçersiz ya da süresi dolmuş')).toBeInTheDocument();
    expect(onAuth).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Doğrulama kodu')).toBeInTheDocument();
  });

  it('can go back to the password screen', async () => {
    vi.mocked(loginUser).mockResolvedValue({ data: { two_factor: true, challenge: 'ch' } });
    render(<Auth onAuth={vi.fn()} />);

    await fillAndSubmit({ email: 'ali@example.com', password: 'password123' });
    fireEvent.click(screen.getByRole('button', { name: 'Giriş ekranına dön' }));

    expect(screen.getByLabelText('Şifre')).toBeInTheDocument();
  });
});
