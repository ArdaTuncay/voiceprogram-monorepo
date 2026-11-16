import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TwoFactorSettings from '../TwoFactorSettings';

vi.mock('../../services/api', () => ({
  fetchTwoFactorStatus: vi.fn(),
  startTwoFactorSetup: vi.fn(),
  enableTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
}));

import {
  disableTwoFactor,
  enableTwoFactor,
  fetchTwoFactorStatus,
  regenerateRecoveryCodes,
  startTwoFactorSetup,
} from '../../services/api';

const SETUP = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  otpauth_uri: 'otpauth://totp/Zircle:ali@example.com?secret=JBSW&issuer=Zircle',
  qr_data_uri: 'data:image/svg+xml;base64,PHN2Zy8+',
  setup_token: 'setup-tok',
};
const CODES = Array.from({ length: 10 }, (_, i) => `abcd${i}-efgh${i}`);

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TwoFactorSettings', () => {
  it('sets two-factor up: password, QR code, a code, then the recovery codes', async () => {
    vi.mocked(fetchTwoFactorStatus).mockResolvedValue({ data: { enabled: false, recovery_codes_left: 0 } });
    vi.mocked(startTwoFactorSetup).mockResolvedValue({ data: SETUP });
    vi.mocked(enableTwoFactor).mockResolvedValue({ data: { recovery_codes: CODES } });
    render(<TwoFactorSettings />);

    expect(await screen.findByText('Kapalı')).toBeInTheDocument();
    await click('Etkinleştir');

    fireEvent.change(screen.getByLabelText('Mevcut şifre'), { target: { value: 'password123' } });
    await click('Devam et');
    expect(startTwoFactorSetup).toHaveBeenCalledWith('password123');

    expect(screen.getByRole('img', { name: 'Doğrulama uygulaması için QR kod' })).toHaveAttribute(
      'src',
      SETUP.qr_data_uri
    );
    expect(screen.getByText(SETUP.secret)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Doğrulama kodu'), { target: { value: '123456' } });
    await click('Doğrula ve etkinleştir');
    expect(enableTwoFactor).toHaveBeenCalledWith('setup-tok', '123456');

    for (const code of CODES) expect(screen.getByText(code)).toBeInTheDocument();
    await click('Kodları kaydettim');

    expect(screen.getByText('Açık')).toBeInTheDocument();
    expect(screen.queryByText(CODES[0])).toBeNull();
  });

  it('shows the error for a wrong setup code and stays on that step', async () => {
    vi.mocked(fetchTwoFactorStatus).mockResolvedValue({ data: { enabled: false, recovery_codes_left: 0 } });
    vi.mocked(startTwoFactorSetup).mockResolvedValue({ data: SETUP });
    vi.mocked(enableTwoFactor).mockResolvedValue({ error: 'Kod geçersiz ya da süresi dolmuş' });
    render(<TwoFactorSettings />);

    await screen.findByText('Kapalı');
    await click('Etkinleştir');
    fireEvent.change(screen.getByLabelText('Mevcut şifre'), { target: { value: 'password123' } });
    await click('Devam et');
    fireEvent.change(screen.getByLabelText('Doğrulama kodu'), { target: { value: '000000' } });
    await click('Doğrula ve etkinleştir');

    expect(screen.getByText('Kod geçersiz ya da süresi dolmuş')).toBeInTheDocument();
    expect(screen.getByLabelText('Doğrulama kodu')).toBeInTheDocument();
  });

  it('turns two-factor off with the password and a code', async () => {
    vi.mocked(fetchTwoFactorStatus).mockResolvedValue({ data: { enabled: true, recovery_codes_left: 7 } });
    vi.mocked(disableTwoFactor).mockResolvedValue({ data: undefined });
    render(<TwoFactorSettings />);

    expect(await screen.findByText('Açık')).toBeInTheDocument();
    expect(screen.getByText(/7 kurtarma kodu kaldı/)).toBeInTheDocument();
    await click('Devre dışı bırak');

    fireEvent.change(screen.getByLabelText('Mevcut şifre'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Doğrulama kodu ya da kurtarma kodu'), {
      target: { value: '123456' },
    });
    await click('Kapat');

    expect(disableTwoFactor).toHaveBeenCalledWith('password123', '123456');
    expect(screen.getByText('Kapalı')).toBeInTheDocument();
  });

  it('replaces the recovery codes with the password and a code, and shows the new ones once', async () => {
    vi.mocked(fetchTwoFactorStatus).mockResolvedValue({ data: { enabled: true, recovery_codes_left: 2 } });
    vi.mocked(regenerateRecoveryCodes).mockResolvedValue({ data: { recovery_codes: CODES } });
    render(<TwoFactorSettings />);

    expect(await screen.findByText(/2 kurtarma kodu kaldı/)).toBeInTheDocument();
    await click('Yeni kurtarma kodları');

    fireEvent.change(screen.getByLabelText('Mevcut şifre'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Doğrulama kodu ya da kurtarma kodu'), {
      target: { value: '123 456' },
    });
    await click('Kodları yenile');

    expect(regenerateRecoveryCodes).toHaveBeenCalledWith('password123', '123456');
    expect(screen.getByText(CODES[0])).toBeInTheDocument();
    await click('Kodları kaydettim');
    expect(screen.getByText(/10 kurtarma kodu kaldı/)).toBeInTheDocument();
    expect(screen.getByText('Açık')).toBeInTheDocument();
  });
});
