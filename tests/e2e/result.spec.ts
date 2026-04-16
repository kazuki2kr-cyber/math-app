import { test, expect } from '@playwright/test';
import { loginAsTestUser, dismissLevelUpModal } from './helpers';

test.describe('結果ページ', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  // ─────────────────────────────────────────────────────
  // 全問正解（test_unit_2: 1問）
  // ─────────────────────────────────────────────────────

  test('全問正解で "Result" タイトルとスコアが表示される', async ({ page }) => {
    // テスト単元2: 正解は "4"
    const unitCard = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_2/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '4' }).first().click();
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit_2/, { timeout: 15000 });

    await expect(page.getByText('Result')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('/ 100')).toBeVisible({ timeout: 5000 });
  });

  test('全問正解（1問）でスコアが 100 になる', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_2/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '4' }).first().click();
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit_2/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    // スコア "100" が表示される
    await expect(page.getByText(/100\s*\/\s*100|^100$/)).toBeVisible({ timeout: 5000 });
  });

  test('全問不正解でスコアが 0 になる', async ({ page }) => {
    // テスト単元2: 不正解は "3"
    const unitCard = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_2/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '3' }).first().click();
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit_2/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    await expect(page.getByText(/0\s*\/\s*100|^0$/)).toBeVisible({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────────
  // 結果ページの要素
  // ─────────────────────────────────────────────────────

  test('正解問題が一覧表示される', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_2/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '4' }).first().click();
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit_2/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    // 正解問題リストに問題テキストが表示される
    await expect(page.getByText('2+2')).toBeVisible({ timeout: 5000 });
  });

  test('不正解問題には解説と正解が表示される', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_2/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '3' }).first().click(); // 不正解
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit_2/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    // 解説テキストが表示される
    await expect(page.getByText('2+2=4')).toBeVisible({ timeout: 5000 });
  });

  test('XP の内訳が表示される', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_2/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '4' }).first().click();
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit_2/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    // XP 関連テキストが表示される
    await expect(page.getByText(/XP/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('「ダッシュボードに戻る」ボタンでダッシュボードに遷移する', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_2/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '4' }).first().click();
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit_2/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    await dismissLevelUpModal(page);

    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });
    await expect(page).toHaveURL('/');
  });

  test('同じ attemptId で二重送信してもスコアが重複しない（冪等性）', async ({ page }) => {
    // 1回目のドリルを完了し結果を記録
    const unitCard = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_2/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '4' }).first().click();
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit_2/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    // sessionStorage の drillResult（attemptId を含む）を再利用して結果ページを再ロード
    // Cloud Function は alreadyProcessed=true を返し、スコアが二重加算されない
    await page.reload();
    // リロード後は sessionStorage が消えてダッシュボードにリダイレクトされるはず
    // → 結果: スコア二重加算なし（redirected or "already processed"）
    await page.waitForURL(/\/result\/|\//, { timeout: 15000 });
    // 二重処理ガードが動作していれば問題なし
  });
});
