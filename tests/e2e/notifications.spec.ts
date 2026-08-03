import { expect, test } from '@playwright/test';
import { loginAsTestUser } from './helpers';

test('未読数・未読強調・すべて既読が端末内状態で連動する', async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('formix_notification_')) localStorage.removeItem(key);
    }
  });

  await loginAsTestUser(page);

  const notificationButton = page.getByRole('button', { name: 'お知らせを開く、未読2件' });
  await expect(notificationButton).toBeVisible();
  await notificationButton.click();
  await page.waitForURL('/notifications');

  const newNotification = page.locator('article', { hasText: '新しいお知らせ' });
  await expect(newNotification).toHaveClass(/bg-emerald-50/);
  await expect(page.getByText('未読', { exact: true })).toHaveCount(2);

  await newNotification.getByRole('button', { name: '既読にする' }).click();
  await expect(page.getByText('未読', { exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: 'すべて既読' }).click();
  await expect(page.getByText('未読', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'すべて既読' })).toHaveCount(0);

  await page.getByRole('button', { name: 'ダッシュボードへ戻る' }).click();
  await page.waitForURL('/');
  await expect(page.getByRole('button', { name: 'お知らせと通知設定を開く' })).toBeVisible();
});
