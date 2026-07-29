import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import UserSettingsModal from '../UserSettingsModal';
import { THEME_STORAGE_KEY } from '../../services/theme';

function mockSystemPreference(prefersLight: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: light)' && prefersLight,
    media: query,
  })) as unknown as typeof window.matchMedia;
}

describe('UserSettingsModal', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockSystemPreference(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens on "Görünüm" by default with the theme selector visible', () => {
    render(<UserSettingsModal onClose={vi.fn()} />);

    expect(screen.getAllByText('Görünüm').length).toBeGreaterThan(0);
    expect(screen.getByRole('radiogroup', { name: 'Tema' })).not.toBeNull();
  });

  it('closes via the X button', () => {
    const onClose = vi.fn();
    render(<UserSettingsModal onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<UserSettingsModal onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches categories, showing a "Yakında" placeholder for the unfilled ones', () => {
    render(<UserSettingsModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Bildirimler' }));

    expect(screen.getByRole('heading', { name: 'Bildirimler' })).not.toBeNull();
    expect(screen.getByText('Yakında')).not.toBeNull();
    // The theme selector only renders for the Appearance category.
    expect(screen.queryByRole('radiogroup', { name: 'Tema' })).toBeNull();
  });

  it('still switches back to "Görünüm" and finds the theme selector again', () => {
    render(<UserSettingsModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Klavye Kısayolları' }));
    fireEvent.click(screen.getByRole('button', { name: 'Görünüm' }));

    expect(screen.getByRole('radiogroup', { name: 'Tema' })).not.toBeNull();
  });

  it('selecting a theme option persists it and applies data-theme — the same mechanism the old toggle used', () => {
    render(<UserSettingsModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Açık' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(screen.getByRole('radio', { name: 'Açık' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Koyu' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('selecting "Sistem" clears the stored override and resolves via the OS preference', () => {
    mockSystemPreference(true);
    render(<UserSettingsModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Koyu' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Sistem' }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('preselects the radio matching whatever preference was already stored', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');

    render(<UserSettingsModal onClose={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'Açık' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Koyu' }).getAttribute('aria-checked')).toBe('false');
  });
});
