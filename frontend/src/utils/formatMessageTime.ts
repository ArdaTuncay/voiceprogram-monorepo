const LOCALE = 'tr-TR';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Whole calendar days between `from` and `to` (positive when `to` is
// earlier), ignoring time-of-day — comparing raw timestamps directly would
// misclassify e.g. "yesterday 23:59" vs "today 00:01" as 23 hours apart
// (same as "today" would be) instead of one calendar day apart.
function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(from).getTime() - startOfDay(to).getTime()) / MS_PER_DAY);
}

/**
 * Discord-style relative timestamp for a message's `inserted_at`:
 *  - today: just the time ("14:32")
 *  - yesterday: "Dün 14:32"
 *  - within the last 7 days (excluding today/yesterday): weekday + time
 *    ("Salı 14:32")
 *  - older: numeric date + time ("15.03.2026 14:32")
 *
 * Locale is pinned to 'tr-TR' throughout (rather than `[]`/the runtime's
 * default, which the older per-component `formatTime` this replaces used)
 * so the weekday name and "DD.MM.YYYY" ordering stay deterministic
 * regardless of the environment's default ICU locale — this app has no
 * i18n and every other UI string is already hardcoded Turkish, so a
 * locale-dependent date format would just be an inconsistency, not
 * flexibility.
 *
 * Elixir sends `inserted_at` as UTC without a trailing "Z", so one is
 * appended when missing — otherwise `Date` parses the string as local
 * time instead of UTC.
 */
export function formatMessageTime(raw: string): string {
  const date = new Date(raw.includes('Z') ? raw : `${raw}Z`);
  const now = new Date();
  const time = date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });

  const dayDiff = daysBetween(now, date);

  if (dayDiff === 0) return time;
  if (dayDiff === 1) return `Dün ${time}`;
  if (dayDiff > 1 && dayDiff <= 7) {
    const weekday = date.toLocaleDateString(LOCALE, { weekday: 'long' });
    return `${weekday} ${time}`;
  }

  const numericDate = date.toLocaleDateString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `${numericDate} ${time}`;
}
