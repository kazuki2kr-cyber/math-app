import { test, expect } from '@playwright/test';
import { loginAsTestUser, completeDrill, dismissLevelUpModal } from './helpers';

test.describe('ドリル演習', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  // ─────────────────────────────────────────────────────
  // 基本フロー
  // ─────────────────────────────────────────────────────

  test('演習開始でドリル画面に遷移し Question 1 が表示される', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();

    await page.waitForURL(/\/drill\/test_unit/, { timeout: 15000 });
    await expect(page.getByText(/Question 1/)).toBeVisible({ timeout: 15000 });
  });

  test('タイマーが表示・カウントされる', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\//, { timeout: 15000 });

    // タイマー要素（00:00 形式）が表示されている
    const timer = page.locator('.font-mono');
    await expect(timer).toBeVisible({ timeout: 10000 });
    await expect(timer).toHaveText(/\d{2}:\d{2}/);
  });

  test('回答前は完了ボタンが無効', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\//, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    // 1問ユニット: まだ選択していない状態では完了ボタンが disabled
    const completeBtn = page.locator('button', { hasText: '演習を完了する' });
    await expect(completeBtn).toBeDisabled({ timeout: 5000 });
  });

  test('選択肢を選ぶと完了ボタンが有効になる（1問ユニット）', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit$/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '2' }).first().click();

    const completeBtn = page.locator('button', { hasText: '演習を完了する' });
    await expect(completeBtn).toBeEnabled({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────────
  // 複数問題ユニット（test_unit_multi: 3問）
  // ─────────────────────────────────────────────────────

  test('複数問題ユニットで問題ナビゲーションができる', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト複数問題単元' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_multi/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    // Q1 を選択
    await page.locator('button', { hasText: '2' }).first().click();

    // 「次の問題へ」ボタンが表示される（最後の問題ではない）
    const nextBtn = page.locator('button', { hasText: '次の問題へ' });
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    await nextBtn.click();

    // Q2 に進む
    await expect(page.getByText(/Question 2/)).toBeVisible({ timeout: 5000 });
  });

  test('「前の問題へ」ボタンで前の問題に戻れる', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト複数問題単元' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_multi/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    // Q1 を選択して次へ
    await page.locator('button', { hasText: '2' }).first().click();
    await page.locator('button', { hasText: '次の問題へ' }).click();
    await page.getByText(/Question 2/).waitFor({ timeout: 5000 });

    // 「前の問題へ」で Q1 に戻る
    await page.locator('button', { hasText: '前の問題へ' }).click();
    await expect(page.getByText(/Question 1/)).toBeVisible({ timeout: 5000 });
  });

  test('第1問では「前の問題へ」ボタンが無効', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト複数問題単元' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_multi/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    const backBtn = page.locator('button', { hasText: '前の問題へ' });
    await expect(backBtn).toBeDisabled({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────────
  // スコアバリエーション（test_unit_multi: 3問）
  // ─────────────────────────────────────────────────────

  test('全問正解で結果ページに遷移する', async ({ page }) => {
    await completeDrill(page, 'テスト複数問題単元', ['2', '4', '6']);
    await expect(page).toHaveURL(/\/result\/test_unit_multi/);
  });

  test('全問不正解でも結果ページに遷移する', async ({ page }) => {
    await completeDrill(page, 'テスト複数問題単元', ['99', '99', '99']);
    await expect(page).toHaveURL(/\/result\/test_unit_multi/);
  });

  // ─────────────────────────────────────────────────────
  // 復習モード（review-mode）
  // ─────────────────────────────────────────────────────

  test('不正解後に復習ボタンが表示される', async ({ page }) => {
    // 1問ユニット (テスト単元) で不正解
    const unitCard = page.locator('.group', { hasText: 'テスト単元' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit$/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    // 不正解の選択肢 "1" を選択
    await page.locator('button', { hasText: '1' }).first().click();
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    // 復習ボタンが表示されるはず
    const reviewBtn = page.locator('button', { hasText: /間違えた問題のみ復習/ });
    await expect(reviewBtn).toBeVisible({ timeout: 10000 });
  });

  test('全問正解後は復習ボタンが表示されない', async ({ page }) => {
    await completeDrill(page, 'テスト単元2', ['4']);
    await dismissLevelUpModal(page);

    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    const unit2Card = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await unit2Card.waitFor({ timeout: 10000 });

    // 全問正解したので復習ボタンは表示されない
    const reviewBtn = unit2Card.locator('button', { hasText: /間違えた問題のみ復習/ });
    await expect(reviewBtn).not.toBeVisible({ timeout: 5000 });
  });

  test('復習モードで不正解問題のみ出題され正解すると totalCorrect が累積される', async ({ page }) => {
    // Step1: テスト単元を不正解で完了
    const unitCard = page.locator('.group', { hasText: 'テスト単元' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit$/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '1' }).first().click(); // 不正解
    await page.locator('button', { hasText: '演習を完了する' }).click();
    await page.waitForURL(/\/result\/test_unit/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    // Step2: 復習モードで正解する
    const reviewBtn = page.locator('button', { hasText: /間違えた問題のみ復習/ });
    await reviewBtn.waitFor({ timeout: 10000 });
    await reviewBtn.click();

    await page.waitForURL(/\/drill\/test_unit\?mode=wrong/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '2' }).first().click(); // 正解
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    // totalCorrect が累積されているか（ランキング行で "1" が表示）
    const myRankRow = page
      .locator('.flex', { has: page.locator('span', { hasText: 'You' }) })
      .first();
    await expect(myRankRow).toContainText('1', { timeout: 15000 });
  });
});
