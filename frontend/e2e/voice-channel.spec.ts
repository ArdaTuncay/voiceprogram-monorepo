import { test, expect, type Page } from '@playwright/test';

/**
 * Two-tab (two-browser-context) WebRTC voice channel test — a real
 * peer-to-peer connection between two distinct users, not a single tab
 * simulating two participants. A single page can't test this: each side
 * needs its own isolated auth session, its own getUserMedia() fake-device
 * stream, and its own RTCPeerConnection — collapsing both users into one
 * tab would mean testing the UI reacting to itself, not two independent
 * WebRTC endpoints actually negotiating and exchanging media.
 *
 * Requires the Chromium fake-media-stream launch flags in
 * playwright.config.ts (--use-fake-ui-for-media-stream / --use-fake-
 * device-for-media-stream) — getUserMedia({ audio: true }) (see
 * useVoiceChannel.ts's join()) would otherwise hang on a permission prompt
 * nothing can click, or fail outright with no real microphone.
 *
 * Uses useVoiceChannel.ts's `window.__e2eVoicePeers` — a DEV-build-only,
 * test-only escape hatch added specifically for this spec (see that file's
 * comment). The hook's normal return value never exposes real
 * RTCPeerConnection objects, only derived state (`remoteStreams`,
 * `participants`, ...), so without it this test could only ever assert on
 * the UI eventually showing a peer row. It could never prove a real WebRTC
 * connection actually reached `connectionState === 'connected'` — the one
 * thing the mocked useVoiceChannel unit tests (vitest,
 * FakeRTCPeerConnection — see PROJECT_ARCHITECTURE.md 4) structurally
 * cannot cover: a fake never transitions its own connectionState on its
 * own, those tests set it manually, so they can't catch a real signaling/
 * ICE bug that stalls a genuine connection before it ever gets there.
 *
 * Test-data cleanup: same no-teardown reasoning as auth-and-chat.spec.ts —
 * every value here is timestamped, colliding with a prior run's leftover
 * rows is not possible.
 */

async function getPeerConnectionStates(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const peers = (window as unknown as { __e2eVoicePeers?: Map<string, RTCPeerConnection> })
      .__e2eVoicePeers;
    if (!peers) return [];
    return Array.from(peers.values()).map((pc) => pc.connectionState);
  });
}

async function registerAndLogIn(page: Page, username: string, email: string, password: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Register (see Auth.tsx) authenticates immediately on success — no
  // separate login step needed, this already lands on Chat.tsx.
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

test('two users hear each other in a voice channel over a real WebRTC connection', async ({
  browser,
}) => {
  const stamp = Date.now();
  const password = 'TestPassword123!';
  const user1 = { username: `e2e_voice1_${stamp}`, email: `e2e-voice1-${stamp}@example.com` };
  const user2 = { username: `e2e_voice2_${stamp}`, email: `e2e-voice2-${stamp}@example.com` };
  const serverName = `E2E Voice Server ${stamp}`;
  const voiceChannelName = `e2e-voice-${stamp}`;

  // Two isolated browser contexts, not two pages in one context — see the
  // header comment above.
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await test.step('register both users, each in their own context', async () => {
      await registerAndLogIn(pageA, user1.username, user1.email, password);
      await registerAndLogIn(pageB, user2.username, user2.email, password);
    });

    let inviteCode = '';

    await test.step('user 1 creates a server and a voice channel, then joins it', async () => {
      await pageA.getByRole('button', { name: 'Sunucu Oluştur', exact: true }).click();
      await pageA.getByLabel('Sunucu Adı').fill(serverName);
      await pageA.getByRole('button', { name: 'Oluştur', exact: true }).click();
      await expect(pageA.getByRole('heading', { name: '# genel' })).toBeVisible();

      // "Ses Kanalı Oluştur" is owner-only UI (see Chat.tsx) — user 1
      // created the server above, so is the owner.
      await pageA.getByRole('button', { name: 'Ses Kanalı Oluştur', exact: true }).click();
      await pageA.getByLabel('Kanal Adı').fill(voiceChannelName);
      await pageA.getByRole('button', { name: 'Kanal Oluştur', exact: true }).click();

      const voiceRow = pageA.locator('.voice-channel-item', { hasText: voiceChannelName });
      await expect(voiceRow).toBeVisible();
      await voiceRow.click();

      // Own row appearing in the participant list confirms getUserMedia()
      // (the fake device) resolved and the channel join succeeded, before
      // user 2 is even involved.
      await expect(pageA.locator('.voice-participant', { hasText: user1.username })).toBeVisible();
    });

    await test.step('user 1 invites user 2 to the server', async () => {
      // A single invite create — nowhere near InviteController's rate limit
      // (10/min, scoped per server_id — see BackendWeb.RateLimiterPlug and
      // PROJECT_ARCHITECTURE.md's security section) even across repeated
      // runs, since each run creates its own fresh server_id.
      await pageA.getByRole('button', { name: 'İnsanları Davet Et' }).click();
      const codeInput = pageA.locator('.invite-code-input');
      await expect(codeInput).not.toHaveValue('');
      inviteCode = await codeInput.inputValue();
      // exact: true — "Kapat" is a substring of the "Mikrofonu Kapat" mute
      // button, which is also on screen (user 1 already joined the voice
      // channel in the previous step).
      await pageA.getByRole('button', { name: 'Kapat', exact: true }).click();
    });

    await test.step('user 2 joins via the invite code and joins the same voice channel', async () => {
      await pageB.getByRole('button', { name: 'Bir Sunucuya Katıl', exact: true }).click();
      await pageB.getByPlaceholder('Davet kodu').fill(inviteCode);
      // exact: true — "Katıl" is a substring of the sidebar's "Bir
      // Sunucuya Katıl" icon button (the one just clicked to open this
      // modal), which is still on screen behind it.
      await pageB.getByRole('button', { name: 'Katıl', exact: true }).click();

      const voiceRow = pageB.locator('.voice-channel-item', { hasText: voiceChannelName });
      await expect(voiceRow).toBeVisible();
      await voiceRow.click();
    });

    await test.step('each side sees the other as a connected participant', async () => {
      await expect(pageA.locator('.voice-participant', { hasText: user2.username })).toBeVisible();
      await expect(pageB.locator('.voice-participant', { hasText: user1.username })).toBeVisible();
    });

    await test.step('a real WebRTC connection actually reaches "connected" on both sides', async () => {
      // Real ICE negotiation over the loopback interface, not mocked — see
      // the header comment. expect.poll (not a fixed sleep()) because this
      // is genuine async network/signaling state: both peers are on
      // localhost with no NAT/firewall between them so it's normally fast,
      // but "normally fast" isn't "instant".
      await expect
        .poll(() => getPeerConnectionStates(pageA), {
          message: 'user 1 side RTCPeerConnection.connectionState',
          timeout: 20_000,
        })
        .toEqual(['connected']);

      await expect
        .poll(() => getPeerConnectionStates(pageB), {
          message: 'user 2 side RTCPeerConnection.connectionState',
          timeout: 20_000,
        })
        .toEqual(['connected']);
    });

    await test.step('user 1 mutes — user 2 sees the mute indicator', async () => {
      await pageA.getByRole('button', { name: 'Mikrofonu Kapat' }).click();

      await expect(
        pageB.locator('.voice-participant', { hasText: user1.username }).locator('.mute-icon')
      ).toBeVisible();
    });

    await test.step('user 1 leaves — user 2 sees the peer disappear', async () => {
      // handleVoiceRoomClick (see Chat.tsx) toggles: clicking the
      // already-active voice channel row leaves it.
      await pageA.locator('.voice-channel-item.active', { hasText: voiceChannelName }).click();

      await expect(pageB.locator('.voice-participant', { hasText: user1.username })).toBeHidden();
    });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
