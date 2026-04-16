import { test, expect } from '@playwright/test';
import { loginAsTestUser, completeDrill, dismissLevelUpModal } from './helpers';

test.describe('ダッシュボード', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('ダッシュボードのタイトルが表示される', async ({ page }) => {
    await expect(page).toHaveTitle(/Formix/);
  });

  test('シードされたユニットカードが表示される', async ({ page }) => {
    await expect(
      page.locator('.group', { hasText: 'テスト単元' }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('複数のユニットカードが表示される', async ({ page }) => {
    const cards = page.locator('.group').filter({ hasText: '演習開始' });
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('全体ランキングにシードユーザーが表示される', async ({ page }) => {
    await expect(
      page.getByText('テストちゃんB (Seed)').first()
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('テスト君A (Seed)').first()).toBeVisible();
  });

  test('ドリル完了後にユニットカードにスコアバッジが表示される', async ({ page }) => {
    await completeDrill(page, 'テスト単元2', ['4']);
    await dismissLevelUpModal(page);

    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });
    await page.reload();

    // スコアバッジ（"/ 100" 形式）がユニットカードに表示される
    const unit2Card = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await expect(unit2Card).toBeVisible({ timeout: 15000 });
    await expect(unit2Card.getByText(/\d+\s*点|\/\s*100|\d+%/)).toBeVisible({ timeout: 10000 });
  });

  test('ドリル完了後に全体ランキングに自分の "You" バッジが表示される', async ({ page }) => {
    await completeDrill(page, 'テスト単元2', ['4']);
    await dismissLevelUpModal(page);

    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });
    await page.reload();
    await page.waitForURL('/', { timeout: 10000 });
    await page.locator('.group').first().waitFor({ timeout: 15000 });

    await expect(page.getByText('You').first()).toBeVisible({ timeout: 30000 });
  });

  test('ユニットカードに「演習開始」ボタンが表示される', async ({ page }) => {
    const startBtn = page
      .locator('.group', { hasText: 'テスト単元' })
      .first()
      .locator('button', { hasText: '演習開始' });
    await expect(startBtn).toBeVisible({ timeout: 10000 });
  });

  test('「演習開始」ボタンでドリルページに遷移する', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\//, { timeout: 15000 });
    await expect(page).toHaveURL(/\/drill\//);
  });

  test('単元別ランキングボタンでランキングページに遷移する', async ({ page }) => {
    // まずドリルを1回完了してトロフィーボタンを表示させる
    await completeDrill(page, 'テスト単元2', ['4']);
    await dismissLevelUpModal(page);

    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    const trophyBtn = page
      .locator('.group', { hasText: 'テスト単元2' })
      .locator('button[aria-label*="ランキングを見る"]');
    await expect(trophyBtn).toBeVisible({ timeout: 10000 });
    await trophyBtn.click();
    await page.waitForURL(/\/ranking\//, { timeout: 15000 });
    await expect(page.locator('h2', { hasText: 'ランキング:' })).toBeVisible({ timeout: 10000 });
  });
});
