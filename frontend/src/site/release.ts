/**
 * The current Zircle release, shown on the İndir and Yenilikler pages.
 * Update these together with desktop/package.json's version when a new
 * desktop build is published as a GitHub release.
 *
 * `date` (YYYY-MM-DD) and `sizeMb` are filled in when the release is
 * actually published; until then the pages leave those rows out.
 */
export const RELEASE = {
  version: '1.0.0',
  /** Shown as "Sürüm 1.0" — the patch number only when it isn't zero. */
  label: '1.0',
  date: null as string | null,
  sizeMb: null as number | null,
  downloadUrl:
    'https://github.com/ArdaTuncay/voiceprogram-monorepo/releases/download/desktop-v1.0.0/Zircle-Setup-1.0.0.exe',
};

/** "19 Kasım 2026" / "November 19, 2026" for a YYYY-MM-DD date. */
export function formatReleaseDate(date: string, language: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
