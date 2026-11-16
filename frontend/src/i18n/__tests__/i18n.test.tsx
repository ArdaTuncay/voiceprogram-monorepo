import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { detectLanguage, t, translate, useLanguageStore } from '..';
import { en } from '../en';
import { rich } from '../rich';
import Auth from '../../components/Auth';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('translate', () => {
  it('returns the Turkish source as-is in Turkish and the English entry in English', () => {
    expect(translate('tr', 'Kaydet')).toBe('Kaydet');
    expect(translate('en', 'Kaydet')).toBe('Save');
  });

  it('fills placeholders in both languages', () => {
    expect(translate('tr', '{name} yazıyor...', { name: 'ali' })).toBe('ali yazıyor...');
    expect(translate('en', '{name} yazıyor...', { name: 'ali' })).toBe('ali is typing...');
  });

  it('picks the English singular or plural form by count', () => {
    const key = '{names} ve {count} kişi daha yazıyor...';
    expect(translate('en', key, { names: 'a, b', count: 1 })).toBe('a, b and 1 other are typing...');
    expect(translate('en', key, { names: 'a, b', count: 3 })).toBe('a, b and 3 others are typing...');
    expect(translate('tr', key, { names: 'a, b', count: 3 })).toBe('a, b ve 3 kişi daha yazıyor...');
  });

  it('t follows the current language', () => {
    useLanguageStore.getState().setLanguage('en');
    expect(t('Kapat')).toBe('Close');
    useLanguageStore.getState().setLanguage('tr');
    expect(t('Kapat')).toBe('Kapat');
  });
});

describe('the English dictionary', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('uses exactly the placeholders of its Turkish key in every entry', () => {
    for (const [key, value] of Object.entries(en)) {
      const forms = typeof value === 'string' ? [value] : [value.one, value.other];
      for (const form of forms) {
        expect(placeholders(form), key).toEqual(placeholders(key));
      }
    }
  });
});

describe('language choice', () => {
  it('defaults to the browser language', () => {
    vi.stubGlobal('navigator', { language: 'tr-TR' });
    expect(detectLanguage()).toBe('tr');
    vi.stubGlobal('navigator', { language: 'de-DE' });
    expect(detectLanguage()).toBe('en');
  });

  it('prefers a saved choice, and setLanguage saves it and updates <html lang>', () => {
    vi.stubGlobal('navigator', { language: 'tr-TR' });
    useLanguageStore.getState().setLanguage('en');
    expect(localStorage.getItem('zircle.language')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(detectLanguage()).toBe('en');
  });
});

describe('rich', () => {
  it('puts nodes where the translation places them', () => {
    useLanguageStore.getState().setLanguage('en');
    render(
      <p data-testid="p">
        {rich(t('{name} kişisine yanıt veriliyor'), { name: <strong>ali</strong> })}
      </p>
    );
    expect(screen.getByTestId('p').innerHTML).toBe('Replying to <strong>ali</strong>');
  });
});

describe('switching language in the UI', () => {
  it('re-renders the sign-in screen in the chosen language', () => {
    render(<Auth onAuth={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Tekrar hoş geldin!' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Dil' }), { target: { value: 'en' } });
    expect(screen.getByRole('heading', { name: 'Welcome back!' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();

    act(() => useLanguageStore.getState().setLanguage('tr'));
    expect(screen.getByRole('button', { name: 'Giriş yap' })).toBeInTheDocument();
  });
});
