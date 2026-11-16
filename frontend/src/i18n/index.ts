/**
 * Turkish/English UI text.
 *
 * Turkish is the source language: every UI string is written in Turkish in
 * the code and passed through `t()` (or the `useT()` hook in components),
 * gettext-style. `en.ts` maps each of those Turkish strings to English, and
 * its keys are the only strings `t()` accepts — so a new string without an
 * English translation is a type error, not a silent fallback.
 *
 * Placeholders are `{name}`; `t('{count} üye', { count })`. An English
 * entry may be `{ one, other }` where the count changes the wording.
 */
import { create } from 'zustand';
import { en, type Translation } from './en';

export type Language = 'tr' | 'en';
export type MessageKey = keyof typeof en;
type Params = Record<string, string | number>;

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'tr', label: 'Türkçe' },
  { code: 'en', label: 'English' },
];

const STORAGE_KEY = 'zircle.language';

function isLanguage(value: unknown): value is Language {
  return value === 'tr' || value === 'en';
}

/** The saved choice, else the browser's language (Turkish for tr-*, English otherwise). */
export function detectLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage blocked — fall through to the browser language.
  }
  const browser = typeof navigator !== 'undefined' ? navigator.language : '';
  return browser.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

interface LanguageState {
  language: Language;
  setLanguage: (language: Language) => void;
}

function applyToDocument(language: Language) {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  language: detectLanguage(),
  setLanguage: (language) => {
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Choice just won't persist across reloads.
    }
    applyToDocument(language);
    set({ language });
  },
}));

applyToDocument(useLanguageStore.getState().language);

/** The current language, for code outside React (API headers, date formats). */
export function currentLanguage(): Language {
  return useLanguageStore.getState().language;
}

/** BCP 47 locale for Intl/toLocale* calls. */
export function currentLocale(): string {
  return currentLanguage() === 'tr' ? 'tr-TR' : 'en-US';
}

function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

function pick(entry: Translation, params?: Params): string {
  if (typeof entry === 'string') return entry;
  return params?.count === 1 ? entry.one : entry.other;
}

/** Translates in a given language. */
export function translate(language: Language, key: MessageKey, params?: Params): string {
  const text = language === 'en' ? pick(en[key], params) : key;
  return interpolate(text, params);
}

/** Translates in the current language — for stores, services and helpers. */
export function t(key: MessageKey, params?: Params): string {
  return translate(currentLanguage(), key, params);
}

/** `t` for components: re-renders the component when the language changes. */
export function useT(): typeof t {
  const language = useLanguageStore((s) => s.language);
  // One stable function per language, so it also works as a hook dependency.
  return translatorFor(language);
}

const boundT = new Map<Language, typeof t>();
function translatorFor(language: Language): typeof t {
  let fn = boundT.get(language);
  if (!fn) {
    fn = (key, params) => translate(language, key, params);
    boundT.set(language, fn);
  }
  return fn;
}
