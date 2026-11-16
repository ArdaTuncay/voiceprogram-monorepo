import { describe, expect, it } from 'vitest';
import { describeDevice } from '../device';

describe('describeDevice', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      'Chrome · Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
      'Edge · Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      'Safari · iPhone',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox · Linux'],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
      'Chrome · Android',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) zircle-desktop/1.0.0 Chrome/130.0 Electron/33.0.0 Safari/537.36',
      'Zircle Masaüstü · macOS',
    ],
  ])('%s → %s', (ua, expected) => {
    expect(describeDevice(ua)).toBe(expected);
  });

  it('falls back when the browser sent nothing useful', () => {
    expect(describeDevice(null)).toBe('Bilinmeyen cihaz');
    expect(describeDevice('curl/8.0')).toBe('Bilinmeyen cihaz');
  });
});
