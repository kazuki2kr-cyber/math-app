import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers';

test.describe('認証フロー', () => {
  test('未認証でダッシュボードにアクセスすると /login にリダイレクトされる', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/login/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('ログインページが正しく表示される', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Formix')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Googleでログイン' })).toBeVisible();
  });

  test('エミュレータモードでエミュレータログインボタンが表示される', async ({ page }) => {
    await page.goto('/login');
    const emuBtn = page.getByTestId('emulator-login-button');
    await expect(emuBtn).toBeVisible({ timeout: 10000 });
  });

  test('エミュレータログインが成功しダッシュボードに遷移する', async ({ page }) => {
    await page.goto('/login');
    const emuBtn = page.getByTestId('emulator-login-button');
    await emuBtn.waitFor({ state: 'visible', timeout: 10000 });
    await emuBtn.click();
    await page.waitForURL('/', { timeout: 15000 });
    await expect(page).toHaveURL('/');
  });

  test('ログイン後にログインページにアクセスするとダッシュボードにリダイレクトされる', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/login');
    await page.waitForURL('/', { timeout: 10000 });
    await expect(page).toHaveURL('/');
  });

  test('エミュレータ管理者ログインボタンが表示される', async ({ page }) => {
    await page.goto('/login');
    const adminBtn = page.getByTestId('emulator-admin-login-button');
    await expect(adminBtn).toBeVisible({ timeout: 10000 });
  });
});
