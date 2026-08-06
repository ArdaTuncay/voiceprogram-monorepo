import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatMessageTime } from '../formatMessageTime';

// Fixed "now": Wednesday 2026-08-12, noon UTC — kept away from midnight so a
// message's local-time bucket (today/yesterday/this week) can't flip
// depending on which timezone the test runner happens to be in (noon UTC
// stays the same calendar day in every real-world UTC offset, ±12h).
const NOW = '2026-08-12T12:00:00Z';

function expectedTime(raw: string): string {
  return new Date(raw).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

describe('formatMessageTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows just the time for a message sent earlier today', () => {
    const raw = '2026-08-12T09:00:00Z';

    expect(formatMessageTime(raw)).toBe(expectedTime(raw));
  });

  it('prefixes with "Dün" for a message sent yesterday', () => {
    const raw = '2026-08-11T12:00:00Z';

    expect(formatMessageTime(raw)).toBe(`Dün ${expectedTime(raw)}`);
  });

  it('shows the weekday name for a message from earlier this week (not today/yesterday)', () => {
    const raw = '2026-08-09T12:00:00Z'; // Sunday — 3 days before the fixed "now"

    expect(formatMessageTime(raw)).toBe(`Pazar ${expectedTime(raw)}`);
  });

  it('shows a numeric DD.MM.YYYY date for anything older than 7 days', () => {
    const raw = '2026-07-20T12:00:00Z';

    expect(formatMessageTime(raw)).toBe(`20.07.2026 ${expectedTime(raw)}`);
  });

  it('treats a UTC timestamp missing its trailing "Z" the same as one that has it', () => {
    const withZ = formatMessageTime('2026-08-12T09:00:00Z');
    const withoutZ = formatMessageTime('2026-08-12T09:00:00');

    expect(withoutZ).toBe(withZ);
  });
});
