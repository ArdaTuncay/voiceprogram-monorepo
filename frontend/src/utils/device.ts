import { t } from '../i18n';

/** Recognisable browser/OS names from a session's user agent, for the
 * active sessions list — "Chrome · Windows", "Safari · iPhone". Not an
 * exhaustive parser: just the clients people actually use, checked in the
 * order where one UA string contains another's token (Edge and Opera say
 * "Chrome", Chrome says "Safari"). */
const BROWSERS: [RegExp, string][] = [
  [/Electron\//, 'Zircle Masaüstü'],
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

function first(list: [RegExp, string][], ua: string): string | undefined {
  return list.find(([pattern]) => pattern.test(ua))?.[1];
}

export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return t('Bilinmeyen cihaz');
  const browser = first(BROWSERS, userAgent);
  const system = first(SYSTEMS, userAgent);
  if (!browser && !system) return t('Bilinmeyen cihaz');
  const browserName = browser === 'Zircle Masaüstü' ? t('Zircle Masaüstü') : browser;
  return [browserName, system].filter(Boolean).join(' · ');
}
