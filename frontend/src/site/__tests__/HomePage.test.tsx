import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../services/api', () => ({
  loginUser: vi.fn(),
  registerUser: vi.fn(),
  loginWithTwoFactor: vi.fn(),
  resendVerification: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

import HomePage from '../HomePage';
import { loginUser, loginWithTwoFactor, registerUser } from '../../services/api';
import { translate, useLanguageStore } from '../../i18n';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function signIn(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('E-posta'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: password } });
  return act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Giriş yap ve tarayıcıda aç' }));
  });
}

describe('HomePage sign-in card', () => {
  it('switches between sign-in and sign-up with the tabs', () => {
    render(<HomePage onAuth={vi.fn()} />);
    expect(screen.queryByLabelText('Kullanıcı adı')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Kayıt ol', pressed: false }));

    // The home page's first step is also titled 'Hesap oluştur', so look inside the card.
    expect(within(document.getElementById('giris')!).getByRole('heading', { name: 'Hesap oluştur' })).toBeInTheDocument();
    expect(screen.getByLabelText('Kullanıcı adı')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kayıt ol', pressed: true })).toBeInTheDocument();
  });

  it("the closing 'Kayıt ol' button turns the card to sign-up", () => {
    render(<HomePage onAuth={vi.fn()} />);
    const closing = screen.getByRole('heading', { name: 'Hemen başla.' }).parentElement!;

    fireEvent.click(closing.querySelector('button')!);

    expect(screen.getByLabelText('Kullanıcı adı')).toBeInTheDocument();
  });

  it('hands the signed-in user to onAuth', async () => {
    const user = { id: 'u1', username: 'ali', email: 'ali@example.com', token: 't' };
    vi.mocked(loginUser).mockResolvedValue({ data: user });
    const onAuth = vi.fn();
    render(<HomePage onAuth={onAuth} />);

    await signIn(' ali@example.com ', 'sifre1234');

    expect(loginUser).toHaveBeenCalledWith('ali@example.com', 'sifre1234');
    expect(onAuth).toHaveBeenCalledWith(user);
  });

  it('shows the error from the server in the card', async () => {
    vi.mocked(loginUser).mockResolvedValue({ error: 'E-posta veya şifre hatalı.' });
    render(<HomePage onAuth={vi.fn()} />);

    await signIn('ali@example.com', 'yanlis123');

    expect(screen.getByRole('alert')).toHaveTextContent('E-posta veya şifre hatalı.');
  });

  it('asks for the two-factor code inside the card, then signs in', async () => {
    const user = { id: 'u1', username: 'ali', email: 'ali@example.com', token: 't' };
    vi.mocked(loginUser).mockResolvedValue({ data: { two_factor: true, challenge: 'c1' } });
    vi.mocked(loginWithTwoFactor).mockResolvedValue({ data: user });
    const onAuth = vi.fn();
    render(<HomePage onAuth={onAuth} />);

    await signIn('ali@example.com', 'sifre1234');
    const card = document.getElementById('giris')!;
    expect(card).toHaveTextContent('İki adımlı doğrulama');

    fireEvent.change(screen.getByLabelText('Doğrulama kodu'), { target: { value: '123 456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Doğrula' }));
    });

    expect(loginWithTwoFactor).toHaveBeenCalledWith('c1', '123456');
    expect(onAuth).toHaveBeenCalledWith(user);
  });

  it('shows the check-your-email step inside the card after signing up', async () => {
    vi.mocked(registerUser).mockResolvedValue({
      data: { message: 'ok', email_verification_required: true },
    });
    render(<HomePage onAuth={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Kayıt ol', pressed: false }));
    fireEvent.change(screen.getByLabelText('Kullanıcı adı'), { target: { value: 'ali' } });
    fireEvent.change(screen.getByLabelText('E-posta'), { target: { value: 'ali@example.com' } });
    fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: 'sifre1234' } });
    await act(async () => {
      fireEvent.submit(document.querySelector('#giris form')!);
    });

    expect(registerUser).toHaveBeenCalledWith('ali', 'ali@example.com', 'sifre1234');
    expect(document.getElementById('giris')).toHaveTextContent('E-postanızı kontrol edin');
  });

  it('opens the forgot-password step inside the card', () => {
    render(<HomePage onAuth={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Şifremi unuttum' }));
    expect(document.getElementById('giris')).toHaveTextContent('Sıfırlama bağlantısı gönder');
  });

  it('is in English when English is picked', () => {
    useLanguageStore.setState({ language: 'en' });
    render(<HomePage onAuth={vi.fn()} />);
    expect(
      screen.getByRole('heading', { level: 1, name: translate('en', 'Arkadaşlarınla konuş, yaz, paylaş.') })
    ).toBeInTheDocument();
  });
});
