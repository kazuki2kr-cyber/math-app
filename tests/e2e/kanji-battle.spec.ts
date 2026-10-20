import { test, expect, Page, TestInfo } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { loginAsAdmin, loginAsTestUser } from './helpers';

const app = initializeApp({ projectId: 'math-app-26c77', databaseURL: 'https://math-app-26c77-default-rtdb.asia-southeast1.firebasedatabase.app' }, 'kanji-browser-test');
const database = getDatabase(app);
const users: string[] = [];
test.beforeAll(async () => {
  if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) throw new Error('Database emulator required');
  for (const email of ['admin@shibaurafzk.com', 'test@shibaurafzk.com']) {
    const auth = getAuth(app);
    const user = await auth.getUserByEmail(email).catch(() => auth.createUser({ email, password: 'emulator-test-password' }));
    users.push(user.uid);
    await getFirestore(app).doc(`users/${user.uid}`).set({ kanjiAccessGranted: true, hasAgreedToTerms: true }, { merge: true });
  }
  await getFirestore(app).doc('units/kanji-browser-test').set({ subject: 'kanji', title: '対戦画面テスト', totalQuestions: 10,
    questions: Array.from({ length: 10 }, (_, i) => ({ id: 'q' + i, question_text: `「やま」を漢字で書く（${i + 1}）`, answer: '山', order: i })),
  });
});
test.afterAll(async () => { await deleteApp(app); });
async function offsetClock(page: Page, offset: number) {
  await page.addInitScript(delta => {
    const NativeDate = Date;
    window.Date = new Proxy(NativeDate, {
      construct(target, args) { return Reflect.construct(target, args.length ? args : [NativeDate.now() + delta]); },
      get(target, key) { return key === 'now' ? () => NativeDate.now() + delta : Reflect.get(target, key); },
    });
  }, offset);
}
async function draw(page: Page) {
  const canvas = page.locator('canvas[aria-label="手書き入力欄"]');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.7, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 5 });
  await page.mouse.up();
}

async function captureScreen(page: Page, testInfo: TestInfo, name: string, fullPage = false) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
test('two users choose a room, cannot write during waiting, finish ten questions despite clock skew', async ({ browser }, testInfo) => {
  test.setTimeout(180000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let roomId = '';
  const payloads: Record<string, unknown>[] = [];
  try {
    await offsetClock(host, 24000);
    await offsetClock(guest, -60000);
    await Promise.all([loginAsAdmin(host), loginAsTestUser(guest)]);
    // Only the external Vision boundary is stubbed; room APIs and finalization use emulators.
    for (const [page, uid] of [[host, users[0]], [guest, users[1]]] as const) {
      await page.route('**/submitKanjiBattleOcr', async route => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }); return;
        }
        const payload = route.request().postDataJSON().data;
        payloads.push(payload);
        const r = (await database.ref(`kanjiBattleRooms/${roomId}`).get()).val();
        const questionResults = payload.questionIds.map((id: string, i: number) => ({
          questionId: id, questionText: '漢字', recognizedText: '', correctText: '山', isCorrect: false,
          responseMs: r.questionAnswers[i][uid].responseMs, baseScore: 0, speedBonus: 0, questionScore: 0,
        }));
        await database.ref(`kanjiBattleRooms/${roomId}/playerScores/${uid}`).set({
          score: 0, correctCount: 0, totalQuestions: 10, totalTimeMs: questionResults.reduce((sum: number, q: { responseMs: number }) => sum + q.responseMs, 0),
          questionResults, submittedAt: Date.now(),
        });
        await route.fulfill({ json: { result: { success: true } }, headers: { 'Access-Control-Allow-Origin': '*' } });
      });
    }
    await host.goto('/yamato/battle');
    await expect(host.getByRole('button', { name: 'ルームを作る', exact: true })).toBeVisible();
    await expect(host.getByPlaceholder('ルーム番号')).toHaveCount(0);
    await host.getByRole('button', { name: 'ルームを作る', exact: true }).click();
    await host.locator('[data-slot="card"]').filter({ hasText: '対戦画面テスト' }).getByRole('button', { name: 'ルーム作成' }).click();
    await host.waitForURL(/\/room\/\d{8}$/);
    roomId = host.url().split('/').pop()!;
    await guest.goto('/yamato/battle');
    await guest.getByRole('button', { name: 'ルームに参加する', exact: true }).click();
    const listing = guest.locator('[data-slot="card"]').filter({ hasText: '対戦画面テスト' });
    await expect(listing).toContainText('1/4人');
    await listing.getByRole('button', { name: 'このルームに参加' }).click();
    await guest.waitForURL(new RegExp('/room/' + roomId + '$'));
    await expect(guest.getByRole('heading', { name: '準備ができたら、いざ勝負。' })).toBeVisible();
    await expect(guest.getByText('参加者を待っています')).toHaveCount(2);
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await captureScreen(guest, testInfo, 'lobby-mobile', true);
    await captureScreen(host, testInfo, 'lobby-desktop', true);
    await Promise.all([host.getByRole('button', { name: '準備完了', exact: true }).click(), guest.getByRole('button', { name: '準備完了', exact: true }).click()]);
    await host.getByRole('button', { name: '対戦を開始', exact: true }).click();
    await expect(guest.locator('canvas')).toHaveCount(0);
    await Promise.all([host.waitForURL(/\/play$/), guest.waitForURL(/\/play$/)]);
    await expect(guest.getByText('まもなく問題を表示します')).toBeVisible();
    await expect(guest.locator('canvas')).not.toBeVisible();
    await captureScreen(guest, testInfo, 'waiting-mobile');
    for (let i = 0; i < 10; i++) {
      await Promise.all([draw(host), draw(guest)]);
      if (i === 0) {
        for (const page of [host, guest]) {
          // Artwork must stay outside the opaque answer card, and ink must remain usable.
          await expect(page.locator('[data-slot="card"]').filter({ has: page.locator('canvas') })).toHaveCSS('background-color', 'rgb(255, 255, 255)');
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        }
        await captureScreen(host, testInfo, 'answering-desktop');
        await captureScreen(guest, testInfo, 'answering-mobile', true);
      }
      await host.getByRole('button', { name: '回答する', exact: true }).click();
      await expect(host.getByRole('button', { name: '送信済み', exact: true })).toBeVisible();
      await guest.getByRole('button', { name: '回答する', exact: true }).click();
      await expect(guest.getByText('次の問題を準備しています')).toBeVisible();
      await expect(guest.locator('canvas')).not.toBeVisible();
    }
    await Promise.all([host.waitForURL(/\/result$/, { timeout: 30000 }), guest.waitForURL(/\/result$/, { timeout: 30000 })]);
    await expect(guest.getByRole('heading', { name: '対戦結果', exact: true })).toBeVisible();
    await expect(guest.getByRole('heading', { name: '問題別スコア', exact: true })).toBeVisible();
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await captureScreen(host, testInfo, 'result-desktop', true);
    await captureScreen(guest, testInfo, 'result-mobile', true);
    const r = (await database.ref(`kanjiBattleRooms/${roomId}`).get()).val();
    expect(r.finalizedAt).toBeTruthy();
    expect(Object.keys(r.results)).toHaveLength(2);
    expect(payloads).toHaveLength(2);
    for (const p of payloads) {
      expect(p.questionIds).toHaveLength(10);
      expect(p.layout).toHaveLength(10);
      expect(String(p.composedImageBase64).length).toBeGreaterThan(10000);
      const inkCounts = await host.evaluate(async payload => {
        const image = new Image();
        image.src = payload.src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return payload.slots.map(slot => {
          const pixels = ctx.getImageData(Math.floor(slot.x * canvas.width), Math.floor(slot.y * canvas.height), Math.floor(slot.width * canvas.width), Math.floor(slot.height * canvas.height)).data;
          let ink = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 200 && pixels[i + 3] > 0) ink++;
          return ink;
        });
      }, { src: String(p.composedImageBase64), slots: (p.layout as { slots: { x: number; y: number; width: number; height: number }[] }[]).map(q => q.slots[0]) });
      expect(inkCounts).toHaveLength(10);
      expect(inkCounts.every(count => count > 100)).toBe(true);
    }
    for (const answers of Object.values(r.questionAnswers) as Record<string, { responseMs: number }>[]) {
      expect(answers[users[0]].responseMs).toBeGreaterThan(0);
      expect(answers[users[1]].responseMs).toBeGreaterThan(0);
    }
  } finally {
    await hostContext.close(); await guestContext.close();
    if (roomId) await database.ref(`kanjiBattleRooms/${roomId}`).remove();
  }
});
