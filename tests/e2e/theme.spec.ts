import { expect, test } from '@playwright/test';
import { loginAsTestUser } from './helpers';

test.describe('表示テーマ', () => {
  test('light / dark / system を切り替え、選択を端末に保存する', async ({ page }) => {
    await loginAsTestUser(page);

    const toggle = page.getByRole('button', { name: /表示テーマ:/ });
    await expect(toggle).toBeVisible();
    // Next.js の開発ツールが固定ボタンに重なる場合があるため、
    // テーマ切替そのものを検証するクリックは DOM 経由で発火する。
    const clickToggle = () => toggle.evaluate((button: HTMLButtonElement) => button.click());

    const initialLabel = await toggle.getAttribute('aria-label');
    if (initialLabel?.includes('端末設定')) {
      await clickToggle();
    } else if (initialLabel?.includes('ダーク')) {
      await clickToggle();
      await clickToggle();
    }

    await expect(toggle).toHaveAttribute('aria-label', /表示テーマ: ライト/);
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    await clickToggle();
    await expect(toggle).toHaveAttribute('aria-label', /表示テーマ: ダーク/);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('formix:theme'))).toBe('dark');

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: /表示テーマ: ダーク/ })).toBeVisible();
  });
});
