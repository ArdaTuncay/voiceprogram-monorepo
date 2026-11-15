import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ConfirmEmailChangePage from '../ConfirmEmailChangePage';

vi.mock('../../services/api', () => ({
  confirmEmailChange: vi.fn(),
}));

import { confirmEmailChange } from '../../services/api';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConfirmEmailChangePage', () => {
  it('confirms with the token from the link and shows success', async () => {
    vi.mocked(confirmEmailChange).mockResolvedValue({ data: { message: 'ok', email: 'yeni@example.com' } });

    render(<ConfirmEmailChangePage token="link-token" />);

    expect(await screen.findByText('E-posta adresin güncellendi')).not.toBeNull();
    expect(confirmEmailChange).toHaveBeenCalledWith('link-token');
  });

  // The token is single-use: StrictMode's double effect run in development
  // must not send it twice and then show the second call's invalid_token.
  it('sends the single-use token only once under StrictMode', async () => {
    vi.mocked(confirmEmailChange).mockResolvedValue({ data: { message: 'ok', email: 'yeni@example.com' } });

    render(
      <StrictMode>
        <ConfirmEmailChangePage token="once" />
      </StrictMode>
    );

    expect(await screen.findByText('E-posta adresin güncellendi')).not.toBeNull();
    expect(confirmEmailChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid_token', 'Bağlantı geçersiz'],
    ['token_expired', 'Bağlantının süresi dolmuş'],
    ['email has already been taken', 'Bu adres artık kullanılamıyor'],
    ['Network error', 'Bir şeyler ters gitti'],
  ])('explains "%s" in plain words', async (error, title) => {
    vi.mocked(confirmEmailChange).mockResolvedValue({ error });

    render(<ConfirmEmailChangePage token="t" />);

    expect(await screen.findByText(title)).not.toBeNull();
  });
});
