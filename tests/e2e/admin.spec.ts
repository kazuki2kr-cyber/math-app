import { test, expect } from '@playwright/test';
import { loginAsTestUser, loginAsAdmin } from './helpers';

test.describe('管理画面', () => {
  test('一般ユーザーは /admin にアクセスすると「権限がありません」が表示される', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/admin');
    await expect(
      page.getByText('管理者権限がありません。')
    ).toBeVisible({ timeout: 10000 });
  });

  test('管理者ユーザーは /admin にアクセスできる', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin');

    // 管理画面が表示される（「権限がありません」が表示されない）
    await expect(
      page.getByText('管理者権限がありません。')
    ).not.toBeVisible({ timeout: 10000 });
  });

  test('管理者画面にタブが表示される', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // 管理画面には複数のタブが存在する
    const tabs = page.getByRole('button').filter({ hasText: /インポート|単元|スコア|XP|不審|分析|ロール|更新履歴/ });
    await expect(tabs.first()).toBeVisible({ timeout: 15000 });
  });

  test('管理者画面でロール管理タブが表示される', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // ロール管理タブボタンをクリック
    const rolesTab = page.getByRole('button').filter({ hasText: 'ロール' }).first();
    await expect(rolesTab).toBeVisible({ timeout: 10000 });
    await rolesTab.click();

    // ロール管理セクションが表示される
    await expect(
      page.getByText(/管理者権限の付与|ロール管理|管理者一覧/)
    ).toBeVisible({ timeout: 10000 });
  });

  test('未認証ユーザーが /admin にアクセスすると /login にリダイレクトされる', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL(/\/login/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
