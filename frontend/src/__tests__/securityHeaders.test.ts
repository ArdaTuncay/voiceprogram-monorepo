/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the production security headers in vercel.json against drifting
// away from the app: the CSP allows index.html's inline theme script by its
// SHA-256 hash, so editing that script without updating the hash would make
// browsers silently block it (theme flashes on load) — this fails first.
// Vitest runs from the frontend root (where vite.config.ts lives).
const root = (path: string) => resolve(process.cwd(), path);

interface VercelConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const vercel = JSON.parse(readFileSync(root('vercel.json'), 'utf8')) as VercelConfig;
const headers = Object.fromEntries(
  vercel.headers.find((rule) => rule.source === '/(.*)')!.headers.map((h) => [h.key, h.value])
);
const csp = headers['Content-Security-Policy'];
const directive = (name: string) =>
  csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `)) ?? '';

describe('vercel.json security headers', () => {
  it("allows every inline <script> in index.html by its exact hash", () => {
    const html = readFileSync(root('index.html'), 'utf8');
    const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

    expect(inlineScripts.length).toBeGreaterThan(0);
    for (const body of inlineScripts) {
      const hash = createHash('sha256').update(body).digest('base64');
      expect(directive('script-src')).toContain(`'sha256-${hash}'`);
    }
  });

  it('never allows arbitrary inline or eval-ed script', () => {
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
    expect(directive('script-src')).not.toContain("'unsafe-eval'");
  });

  it('blocks framing, plugins and base-tag hijacking', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  it('sends the remaining hardening headers', () => {
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toContain('microphone=(self)');
    expect(headers['Permissions-Policy']).toContain('display-capture=(self)');
    expect(headers['Strict-Transport-Security']).toMatch(/^max-age=\d+/);
  });

  // "Birlikte izle" (WatchPartyPanel): the YouTube embed is the only page
  // that may be framed, and YouTube's script is never loaded into ours.
  it('frames only the YouTube embed, without allowing its script', () => {
    expect(directive('frame-src')).toBe('frame-src https://www.youtube-nocookie.com');
    expect(directive('script-src')).not.toContain('youtube');
  });

  it('keeps the SPA rewrite', () => {
    expect((vercel as unknown as { rewrites: unknown[] }).rewrites).toEqual([
      { source: '/(.*)', destination: '/index.html' },
    ]);
  });
});
