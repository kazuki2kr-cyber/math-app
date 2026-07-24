import { expect, test, type APIRequestContext } from '@playwright/test';
import { loginAsTestUser } from './helpers';

async function grantKanjiAccess(request: APIRequestContext) {
  const signInResponse = await request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key',
    {
      data: {
        email: 'test@shibaurafzk.com',
        password: 'emulator-test-password',
        returnSecureToken: true,
      },
    },
  );
  expect(signInResponse.ok()).toBe(true);
  const { localId } = await signInResponse.json() as { localId: string };
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'math-app-26c77';
  const userUrl = [
    `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/users/${localId}`,
    '?updateMask.fieldPaths=kanjiAccessGranted',
    '&updateMask.fieldPaths=kanjiAccessBlocked',
  ].join('');
  const patchResponse = await request.patch(userUrl, {
    headers: { Authorization: 'Bearer owner' },
    data: {
      fields: {
        kanjiAccessGranted: { booleanValue: true },
        kanjiAccessBlocked: { booleanValue: false },
      },
    },
  });
  expect(patchResponse.ok()).toBe(true);
}

test.describe('表示テーマ', () => {
  test('light / dark / system を切り替え、選択を端末に保存する', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsTestUser(page);
    await page.evaluate(() => window.localStorage.removeItem('formix:theme'));
    await page.reload();

    const openSettings = page.getByRole('button', { name: '表示設定を開く' });
    await expect(openSettings).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    await openSettings.click();
    const settingsDialog = page.getByRole('dialog', { name: '表示設定' });
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: /ライト/ })).toHaveAttribute('aria-pressed', 'true');
    await settingsDialog.getByRole('button', { name: /^ダーク/ }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('formix:theme'))).toBe('dark');

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: '表示設定を開く' })).toBeVisible();

    await grantKanjiAccess(request);
    await page.goto('/yamato');
    const kanjiDashboardTitle = page.getByRole('heading', { name: '漢字ドリル一覧' });
    await expect(kanjiDashboardTitle).toBeVisible({ timeout: 15000 });
    const darkKanjiStyles = await kanjiDashboardTitle.evaluate((title) => ({
      titleColor: getComputedStyle(title).color,
      pageBackground: getComputedStyle(title.closest('.min-h-screen') as HTMLElement).backgroundColor,
    }));
    expect(darkKanjiStyles.titleColor).not.toBe('rgb(67, 20, 7)');
    expect(darkKanjiStyles.pageBackground).not.toBe('rgb(253, 246, 227)');

    await page.getByRole('button', { name: '表示設定を開く' }).click();
    await page.getByRole('dialog', { name: '表示設定' }).getByRole('button', { name: /^端末設定に合わせる/ }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('formix:theme'))).toBe('system');

    await page.getByRole('button', { name: '表示設定を開く' }).click();
    await page.getByRole('dialog', { name: '表示設定' }).getByRole('button', { name: /^ライト/ }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});
