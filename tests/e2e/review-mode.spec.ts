import { test, expect } from '@playwright/test';

test.describe('Formix Review Mode and Ranking Accuracy E2E', () => {
  test('Should track correct answers accurately in review mode and update ranking', async ({ page }) => {
    // 1. ログイン
    await page.goto('/login');
    const emuBtn = page.getByTestId('emulator-login-button');
    await emuBtn.waitFor({ state: 'visible', timeout: 10000 });
    await emuBtn.click();
    await page.waitForURL('/', { timeout: 15000 });

    // 利用規約同意モーダル処理
    const termsCheckbox = page.getByRole('checkbox', { name: /利用規約およびプライバシーポリシーの内容を確認し/ });
    const agreeBtn = page.getByRole('button', { name: '同意して学習を始める' });
    try {
      if (await termsCheckbox.isVisible({ timeout: 5000 })) {
        await termsCheckbox.click({ force: true }); // checkより確実に発火させることがある
        await expect(agreeBtn).toBeEnabled({ timeout: 5000 });
        await agreeBtn.click();
        await expect(termsCheckbox).toBeHidden({ timeout: 10000 });
      }
    } catch (e) {}

    // ========================================================
    // 2. まずわざと1問だけ間違える演習を行う
    //    (復習モードの対象を作るため)
    // ========================================================
    const unit1Card = page.locator('.group', { hasText: 'テスト単元' }).first();
    await expect(unit1Card).toBeVisible({ timeout: 10000 });
    await unit1Card.locator('button', { hasText: '演習開始' }).click();

    await page.waitForURL(/\/drill\/test_unit/, { timeout: 15000 });
    
    // Q1: 不正解 (適当に1を選択。正解は 2)
    await page.locator('button', { hasText: '1' }).first().click();

    const completeBtn = page.locator('button', { hasText: '演習を完了する' });
    await expect(completeBtn).toBeEnabled({ timeout: 5000 });
    await completeBtn.click();

    await page.waitForURL(/\/result\/test_unit/, { timeout: 15000 });
    await expect(page.getByText('Result')).toBeVisible({ timeout: 20000 });
    
    // ダッシュボードに戻る
    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    // ========================================================
    // 3. 復習モードを実行する
    // ========================================================
    // 「間違えた問題のみ復習 (1問)」ボタンが表示されているはず
    const reviewBtn = page.locator('button', { hasText: /間違えた問題のみ復習/ });
    await expect(reviewBtn).toBeVisible({ timeout: 10000 });
    await reviewBtn.click();

    await page.waitForURL(/\/drill\/test_unit\?mode=wrong/, { timeout: 15000 });
    
    // 復習モードで1問解答（正解は 2）
    await page.locator('button', { hasText: '2' }).first().click();
    
    const completeReviewBtn = page.locator('button', { hasText: '演習を完了する' });
    await expect(completeReviewBtn).toBeEnabled({ timeout: 5000 });
    await completeReviewBtn.click();

    await page.waitForURL(/\/result\/test_unit/, { timeout: 15000 });
    await expect(page.getByText('Result')).toBeVisible({ timeout: 20000 });

    // ========================================================
    // 4. ランキングでの正解数カウントを確認
    //    1回目：0問正解 (1問中)
    //    2回目（復習）：1問正解
    //    合計：1問正解 になっているはず
    // ========================================================
    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    // 努力家ランキングの自分のスコアを確認
    const myRankRow = page.locator('.flex', { has: page.locator('span', { hasText: 'You' }) }).first();
    // totalCorrect が表示される場所を特定（1問正解）
    await expect(myRankRow).toContainText('1'); 
  });
});
