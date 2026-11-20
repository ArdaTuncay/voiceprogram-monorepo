import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import FeaturesPage from '../FeaturesPage';
import { translate, useLanguageStore } from '../../i18n';

afterEach(() => {
  cleanup();
  useLanguageStore.setState({ language: 'tr' });
});

describe('FeaturesPage', () => {
  it('lists the four feature groups', () => {
    render(<FeaturesPage />);
    for (const name of ['Ses', 'Sohbet', 'Topluluk', 'Hesap ve uygulama']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByText("Resimler 8 MB'a, belgeler ve arşivler 25 MB'a kadar.")).toBeInTheDocument();
  });

  it('marks Özellikler as the current page in the menu', () => {
    render(<FeaturesPage />);
    const menu = screen.getByRole('navigation', { name: 'Ana menü' });
    expect(within(menu).getByRole('link', { name: 'Özellikler' })).toHaveAttribute('aria-current', 'page');
  });

  it('sends "Tarayıcıda aç" to the sign-in page, and "Windows için indir" to the download page', () => {
    render(<FeaturesPage />);
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'Tarayıcıda aç' })).toHaveAttribute('href', '/giris');
    expect(within(main).getByRole('link', { name: 'Windows için indir' })).toHaveAttribute('href', '/indir');
  });

  it('is in English when English is picked', () => {
    useLanguageStore.setState({ language: 'en' });
    render(<FeaturesPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: translate('en', 'Sohbet için gereken her şey.') })
    ).toBeInTheDocument();
  });
});
