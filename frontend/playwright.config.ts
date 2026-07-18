import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * E2E tests drive the real dev stack end to end (frontend UI -> Phoenix
 * channels/API -> Postgres), not mocks — so both dev servers need to be
 * running. `webServer` accepts an array (see Playwright's TestConfigWebServer
 * docs), so both are started/health-checked here automatically; the only
 * thing that still needs to be up ahead of time is Postgres itself (see
 * PROJECT_ARCHITECTURE.md's "Yerel Geliştirme Ortamı Kurulumu" — this
 * machine's native Postgres install isn't a Windows service, so it needs a
 * manual `pg_ctl start` after every reboot; there's no equivalent
 * webServer-style hook for that here since Playwright only manages the two
 * Node/BEAM processes below, not arbitrary system services).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Backend test data isn't isolated per worker (see e2e/auth-and-chat.spec.ts's
  // header comment on the cleanup strategy) — keeping this at 1 avoids two
  // workers' timestamp-based "unique" usernames landing in the same
  // millisecond and colliding, however unlikely.
  workers: 1,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      name: 'backend',
      command: 'mix phx.server',
      cwd: path.resolve(import.meta.dirname, '../backend'),
      // Any HTTP response (including the 401 this unauthenticated GET
      // actually returns) counts as "server is up" for Playwright's
      // readiness poll — see testConfig.webServer docs.
      url: 'http://localhost:4000/api/servers',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      name: 'frontend',
      command: 'npm run dev',
      cwd: import.meta.dirname,
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60 * 1000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
