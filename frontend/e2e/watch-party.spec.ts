import { test, expect, type Page } from '@playwright/test';

/**
 * "Birlikte izle" end to end: two users in the same voice room watch the
 * same YouTube video, and play/pause/seek by either one reaches the other —
 * through the real embed, the real postMessage protocol (see
 * services/watchPlayers.ts) and the real WatchChannel/WatchParty.Room.
 *
 * The YouTube <video> lives in a cross-origin iframe; Playwright can still
 * evaluate inside it, which is how this reads each side's actual playback
 * and acts like a user clicking the player's own controls.
 *
 * Needs network access to youtube-nocookie.com. Uses Blender's Big Buck
 * Bunny (Creative Commons, ~10 min) so there's room to seek.
 */

const VIDEO_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

/** The verification link's token, from the dev server's Swoosh mailbox. */
async function verificationToken(page: Page, email: string): Promise<string> {
  let token: string | undefined;
  await expect
    .poll(async () => {
      const res = await page.request.get('http://localhost:4000/dev/mailbox/json');
      const { data } = (await res.json()) as { data: unknown[] };
      const mail = data.find((m) => JSON.stringify(m).includes(email));
      token = mail ? JSON.stringify(mail).match(/verify-email\/([A-Za-z0-9_-]+)/)?.[1] : undefined;
      return token;
    }, { message: `verification email for ${email}` })
    .toBeTruthy();
  return token!;
}

// Registering now ends at "check your email" — verify through the dev
// mailbox, then sign in.
async function registerAndLogIn(page: Page, username: string, email: string, password: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Kayıt ol' }).click();
  await page.getByLabel('Kullanıcı adı').fill(username);
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Şifre').fill(password);
  await page.getByRole('button', { name: 'Devam et' }).click();
  await expect(page.getByText('E-postanızı kontrol edin')).toBeVisible();

  const token = await verificationToken(page, email);
  const verified = await page.request.get(`http://localhost:4000/api/verify-email/${token}`);
  expect(verified.ok()).toBe(true);

  await page.getByRole('button', { name: 'Giriş ekranına dön' }).click();
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Şifre').fill(password);
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Çıkış yap' })).toBeVisible();
}

function youtubeFrame(page: Page) {
  const frame = page.frames().find((f) => f.url().startsWith('https://www.youtube-nocookie.com/embed/'));
  if (!frame) throw new Error('YouTube embed not found');
  return frame;
}

async function playback(page: Page): Promise<{ time: number; paused: boolean } | null> {
  try {
    return await youtubeFrame(page).evaluate(() => {
      const video = document.querySelector('video');
      return video && video.readyState > 0 ? { time: video.currentTime, paused: video.paused } : null;
    });
  } catch {
    return null;
  }
}

async function inPlayer(page: Page, action: string) {
  await youtubeFrame(page).evaluate((script) => {
    const video = document.querySelector('video')!;
    new Function('video', script)(video);
  }, action);
}

test('two users in a voice room watch a YouTube video in sync', async ({ browser }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const password = 'TestPassword123!';
  const user1 = { username: `e2e_watch1_${stamp}`, email: `e2e-watch1-${stamp}@example.com` };
  const user2 = { username: `e2e_watch2_${stamp}`, email: `e2e-watch2-${stamp}@example.com` };
  const voiceChannelName = `e2e-watch-${stamp}`;

  // Turkish UI: the locators below use the Turkish source strings.
  const contextA = await browser.newContext({ locale: 'tr-TR' });
  const contextB = await browser.newContext({ locale: 'tr-TR' });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await test.step('both users end up in the same voice room', async () => {
      await registerAndLogIn(pageA, user1.username, user1.email, password);
      await registerAndLogIn(pageB, user2.username, user2.email, password);

      await pageA.getByRole('button', { name: 'Sunucu Ekle' }).click();
      await pageA.getByRole('menuitem', { name: 'Sunucu Oluştur' }).click();
      await pageA.getByLabel('Sunucu Adı').fill(`E2E Watch ${stamp}`);
      await pageA.getByRole('button', { name: 'Oluştur', exact: true }).click();
      await expect(pageA.locator('.channel-intro')).toBeVisible();

      await pageA.getByRole('button', { name: 'Kanal Oluştur', exact: true }).click();
      await pageA.getByRole('menuitem', { name: 'Sesli kanal' }).click();
      await pageA.getByLabel('Kanal Adı').fill(voiceChannelName);
      await pageA.locator('.create-channel-submit-btn').click();

      await pageA.getByRole('button', { name: 'İnsanları Davet Et' }).click();
      const codeInput = pageA.locator('.invite-code-input');
      await expect(codeInput).not.toHaveValue('');
      const inviteCode = await codeInput.inputValue();
      await pageA.getByRole('button', { name: 'Kapat', exact: true }).click();

      await pageB.getByRole('button', { name: 'Sunucu Ekle' }).click();
      await pageB.getByRole('menuitem', { name: 'Bir Sunucuya Katıl' }).click();
      await pageB.getByPlaceholder('Davet kodu').fill(inviteCode);
      await pageB.getByRole('button', { name: 'Katıl', exact: true }).click();

      for (const page of [pageA, pageB]) {
        await page.locator('.voice-channel-item', { hasText: voiceChannelName }).click();
      }
      // Each participant's avatar carries their name as its title, whichever
      // layout VoiceOrbit picks for the room's size.
      await expect(pageA.locator(`.voice-participant-list [title^="${user2.username}"]`).first()).toBeVisible();
      await expect(pageB.locator(`.voice-participant-list [title^="${user1.username}"]`).first()).toBeVisible();
    });

    await test.step('user 1 opens a video — user 2 is offered it', async () => {
      await pageA.getByRole('button', { name: 'Birlikte İzle' }).click();
      await pageA.getByLabel('Video bağlantısı').fill(VIDEO_URL);
      await pageA.getByRole('button', { name: 'Aç', exact: true }).click();

      for (const page of [pageA, pageB]) {
        await expect(page.getByText(`${user1.username} açtı · YouTube`)).toBeVisible();
        await page.getByRole('button', { name: 'İzlemeye katıl' }).click();
      }
    });

    await test.step("user 1 presses play — user 2's player starts at the same spot", async () => {
      // Until the embed has built its player, a click on it does nothing.
      await expect
        .poll(
          async () => {
            try {
              return await youtubeFrame(pageA).evaluate(() => !!document.querySelector('.html5-video-player'));
            } catch {
              return false;
            }
          },
          { timeout: 30_000 }
        )
        .toBe(true);
      await pageA.waitForTimeout(1_000);
      // Clicking the middle of the player — its big play button — as a user would.
      await pageA.locator('iframe[title="YouTube videosu"]').click({ timeout: 30_000 });

      await expect
        .poll(async () => (await playback(pageB))?.paused, { timeout: 30_000, message: 'user 2 playing' })
        .toBe(false);

      // Give the sync loop a few ticks, then compare.
      await pageA.waitForTimeout(4_000);
      const [a, b] = await Promise.all([playback(pageA), playback(pageB)]);
      expect(a?.paused).toBe(false);
      expect(Math.abs(a!.time - b!.time)).toBeLessThan(1.5);
    });

    await test.step("user 2 pauses — user 1's player pauses too", async () => {
      await inPlayer(pageB, 'video.pause()');

      await expect
        .poll(async () => (await playback(pageA))?.paused, { timeout: 10_000, message: 'user 1 paused' })
        .toBe(true);
      const [a, b] = await Promise.all([playback(pageA), playback(pageB)]);
      expect(Math.abs(a!.time - b!.time)).toBeLessThan(1.5);
    });

    await test.step("user 1 jumps ahead and plays — user 2 follows", async () => {
      await inPlayer(pageA, 'video.currentTime = 120; video.play()');

      await expect
        .poll(
          async () => {
            const b = await playback(pageB);
            return b !== null && !b.paused && b.time > 119 && b.time < 130;
          },
          { timeout: 15_000, message: 'user 2 playing from ~2:00' }
        )
        .toBe(true);
    });

    await test.step('user 1 closes the video for everyone', async () => {
      await pageA.getByRole('button', { name: 'Videoyu kapat' }).click();
      await expect(pageB.getByRole('button', { name: 'İzlemeye katıl' })).toBeHidden();
      await expect(pageB.locator('.watch-panel-player')).toBeHidden();
    });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
