import { test, expect } from '@playwright/test';

/**
 * Drives the real dev stack (frontend -> Phoenix API/channels -> Postgres
 * `backend_dev`), not mocks — see playwright.config.ts's webServer entries.
 *
 * Test-data cleanup strategy: no automatic DB teardown, by design.
 *
 * - Every value this spec writes (username/email/server name/message) is
 *   timestamped (`Date.now()`), so distinct runs can never collide with
 *   each other or with prior runs' leftover rows — the same guarantee a
 *   teardown step would otherwise exist to provide.
 * - `backend_dev` is a local, single-developer database, not a shared or
 *   production one; accumulating a handful of `e2e_user_<timestamp>` rows
 *   from repeated local runs is the same kind of residue manual local
 *   testing through the browser already leaves behind, and costs nothing
 *   to leave in place.
 * - `playwright.config.ts` pins `workers: 1` specifically so two workers'
 *   `Date.now()`-based "unique" values can't land in the same millisecond
 *   and collide — see its comment.
 *
 * If this DB ever stops being safe to leave residue in (e.g. a shared CI
 * Postgres instance, once e2e is added to CI in a later pass), revisit
 * this — a `Backend.Repo` truncate in `afterEach` calling the backend
 * directly, or a dedicated `backend_e2e` database, would be the way to add
 * real isolation without inventing an admin API just for tests.
 */

test('register, log out, log back in, create a server, send a message', async ({ page }) => {
  const stamp = Date.now();
  const username = `e2e_user_${stamp}`;
  const email = `e2e-${stamp}@example.com`;
  const password = 'TestPassword123!';
  const serverName = `E2E Server ${stamp}`;
  const messageText = `Hello from Playwright e2e ${stamp}`;

  await test.step('register', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome back!' })).toBeVisible();

    // Auth.tsx defaults to login mode — switch to register.
    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();

    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Successful register/login swaps Auth.tsx out for Chat.tsx — the
    // logout button and the user's own name in the user panel only exist
    // once that's happened, so waiting on either is a real assertion that
    // registration succeeded, not just that the request was sent.
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(page.getByText(username, { exact: true })).toBeVisible();
  });

  await test.step('log out, then log back in with the same account', async () => {
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back!' })).toBeVisible();

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log In' }).click();

    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(page.getByText(username, { exact: true })).toBeVisible();
  });

  await test.step('create a server (lands on its auto-created #genel channel)', async () => {
    // exact: true on both — "Oluştur" is a substring of "Sunucu Oluştur"
    // (the sidebar's icon button that opens this modal), and Playwright's
    // default getByRole name match is substring, not exact.
    await page.getByRole('button', { name: 'Sunucu Oluştur', exact: true }).click();
    await page.getByLabel('Sunucu Adı').fill(serverName);
    await page.getByRole('button', { name: 'Oluştur', exact: true }).click();

    // Backend.Servers.create_server/2 creates a default "genel" text
    // channel in the same transaction as the server, and the frontend
    // auto-selects the server's first text channel on creation (see
    // useServerStore.ts's setActiveServerId -> loadChannelsForActiveServer)
    // — no extra channel-picking step needed.
    await expect(page.getByRole('heading', { name: '# genel' })).toBeVisible();
  });

  await test.step('send a message and see it appear', async () => {
    const messageInput = page.getByPlaceholder('Message #genel');
    await messageInput.fill(messageText);
    await messageInput.press('Enter');

    await expect(page.getByText(messageText, { exact: true })).toBeVisible();
  });
});
