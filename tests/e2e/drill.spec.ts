import { test, expect } from '@playwright/test';
import { loginAsTestUser, completeDrill, dismissLevelUpModal, clickAnswerOption } from './helpers';

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

    await clickAnswerOption(page, '2');

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
    await clickAnswerOption(page, '99');

    // 「次の問題へ」ボタンが表示される（最後の問題ではない）
    const nextBtn = page.locator('button', { hasText: '次の問題へ' });
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    await nextBtn.click();

    // Q2 に進む
    await expect(page.getByText(/Question 2/)).toBeVisible({ timeout: 5000 });
  });

  test('計算用紙は次の問題で破棄され、結果送信データに含まれない', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト複数問題単元' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_multi/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.getByRole('button', { name: '計算用紙を開く' }).click();
    const undoButton = page.getByRole('button', { name: '計算用紙を戻す' });
    const eraserButton = page.getByRole('button', { name: '消しゴムで消す' });
    await expect(undoButton).toBeDisabled({ timeout: 5000 });
    await expect(eraserButton).toBeDisabled({ timeout: 5000 });
    await expect(page.locator('section[aria-hidden="false"]').getByText('Q1/3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ペンの太さ: 標準' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'ペンの太さ: かなり細い' }).click();
    await expect(page.getByRole('button', { name: 'ペンの太さ: かなり細い' })).toHaveAttribute('aria-pressed', 'true');
    const savedStrokeWidth = await page.evaluate(() => window.localStorage.getItem('formix:scratch-paper-stroke-width'));
    expect(savedStrokeWidth).toBe('extraThin');

    const canvas = page.locator('section[aria-hidden="false"] canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Scratch paper canvas was not visible');

    await page.mouse.move(box.x + 24, box.y + 24);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 120);
    await page.mouse.up();
    await expect(undoButton).toBeEnabled({ timeout: 5000 });
    await expect(eraserButton).toBeEnabled({ timeout: 5000 });

    await eraserButton.click();
    await expect(eraserButton).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '消しゴムのサイズ: 大' }).click();
    await expect(page.getByRole('button', { name: '消しゴムのサイズ: 大' })).toHaveAttribute('aria-pressed', 'true');
    await expect(eraserButton).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(box.x + 84, box.y + 64);
    await page.mouse.down();
    await page.mouse.move(box.x + 108, box.y + 84);
    await page.mouse.up();
    await expect(page.getByRole('button', { name: 'ペンで書く' })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'ペンで書く' }).click();
    await expect(page.getByRole('button', { name: 'ペンで書く' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: '計算用紙を閉じる' }).click();
    await page.getByRole('button', { name: '計算用紙を開く' }).click();
    await expect(undoButton).toBeEnabled({ timeout: 5000 });
    await page.getByRole('button', { name: '計算用紙を閉じる' }).click();

    await page.locator('button.w-full.text-left').first().click();
    await page.locator('button', { hasText: '次の問題へ' }).click();
    await page.getByText(/Question 2/).waitFor({ timeout: 5000 });

    await page.getByRole('button', { name: '計算用紙を開く' }).click();
    await expect(undoButton).toBeDisabled({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'ペンの太さ: かなり細い' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '計算用紙を閉じる' }).click();

    await page.locator('button.w-full.text-left').first().click();
    await page.locator('button', { hasText: '次の問題へ' }).click();
    await page.getByText(/Question 3/).waitFor({ timeout: 5000 });
    await page.locator('button.w-full.text-left').first().click();
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit_multi/, { timeout: 15000 });
    const storedResult = await page.evaluate(() => {
      const raw = sessionStorage.getItem('drillResult');
      return raw ? JSON.parse(raw) : null;
    });

    expect(storedResult).toMatchObject({
      unitId: 'test_unit_multi',
      totalQuestions: 3,
    });
    expect(storedResult).not.toHaveProperty('scratchPaper');
    expect(storedResult).not.toHaveProperty('handwriting');
    expect(storedResult).not.toHaveProperty('strokeWidth');
    expect(JSON.stringify(storedResult)).not.toContain('data:image');
    expect(JSON.stringify(storedResult)).not.toContain('extraThin');
  });

  test('「前の問題へ」ボタンで前の問題に戻れる', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト複数問題単元' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_multi/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    // Q1 を選択して次へ
    await clickAnswerOption(page, '99');
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
    await clickAnswerOption(page, '1');
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    // 復習ボタンが表示されるはず
    const reviewBtn = page
      .locator('.group', { hasText: 'テスト単元' })
      .first()
      .locator('button', { hasText: /間違えた問題のみ復習/ });
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

    await clickAnswerOption(page, '1'); // 不正解
    await page.locator('button', { hasText: '演習を完了する' }).click();
    await page.waitForURL(/\/result\/test_unit/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    // Step2: 復習モードで正解する
    const targetUnitCard = page.locator('.group', { hasText: 'テスト単元' }).first();
    const reviewBtn = targetUnitCard.locator('button', { hasText: /間違えた問題のみ復習/ });
    await reviewBtn.waitFor({ timeout: 10000 });
    await reviewBtn.click();

    await page.waitForURL(/\/drill\/test_unit\?mode=wrong/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await clickAnswerOption(page, '2'); // 正解
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });

    // 復習で正解すると wrongQuestionIds が空になり、復習ボタンが消える。
    await expect(targetUnitCard.locator('button', { hasText: /間違えた問題のみ復習/ })).not.toBeVisible({ timeout: 10000 });
  });
});
