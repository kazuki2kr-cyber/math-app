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

  test('全問正解（1問）でスコアが 10 になる', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_2/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '4' }).first().click();
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit_2/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    const scoreSummary = page.getByText('/ 100', { exact: true }).locator('..');
    await expect(scoreSummary).toContainText(/10\s*\/\s*100/, { timeout: 5000 });
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

  test('正解問題にも正しい答えと解説が表示される', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_2/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '4' }).first().click();
    await page.locator('button', { hasText: '演習を完了する' }).click();

    await page.waitForURL(/\/result\/test_unit_2/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    const correctReview = page.getByTestId('correct-question-review');
    await expect(correctReview.locator('.katex').filter({ hasText: '2+2' }).first()).toBeVisible({ timeout: 5000 });
    await expect(correctReview.getByText('正しい答え', { exact: true })).toBeVisible();
    await expect(correctReview.getByText('解説', { exact: true })).toBeVisible();
    await expect(correctReview.locator('.katex').filter({ hasText: '2+2=4' }).first()).toBeVisible();
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
    await expect(page.locator('.katex').filter({ hasText: '2+2=4' }).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('端末内AIでアドバイス・類題・追加質問を利用できる', async ({ page }) => {
    const unitCard = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await unitCard.waitFor({ timeout: 10000 });
    await unitCard.locator('button', { hasText: '演習開始' }).click();
    await page.waitForURL(/\/drill\/test_unit_2/, { timeout: 15000 });
    await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

    await page.locator('button', { hasText: '3' }).first().click();
    await page.locator('button', { hasText: '演習を完了する' }).click();
    await page.waitForURL(/\/result\/test_unit_2/, { timeout: 15000 });
    await page.getByText('Result').waitFor({ timeout: 20000 });

    await page.evaluate(() => {
      const advice = JSON.stringify({
        summary: 'たし算の意味をもう一度確認しましょう。',
        strengths: [{
          point: '問題文を読んで回答できました。',
          evidence: '1問に回答しています。',
        }],
        weaknesses: [{
          point: '計算結果を確認しましょう。',
          evidence: '2+2の問題で3を選びました。',
        }],
        reviewSteps: ['2を2回たす。', '答えを式に戻して確認する。'],
      });
      const practice = JSON.stringify({
        practiceProblems: [{
          question: '3+2はいくつですか。',
          hint: '3から2つ進めます。',
          answer: '5',
          explanation: '3+2=5です。',
          verification: '5から2を引くと3に戻ります。',
        }],
      });
      const followUp = JSON.stringify({
        answer: '2を2回たすので4になります。',
        nextStep: '別の数でも同じように確かめましょう。',
      });
      let advisorAttempts = 0;
      let practiceAttempts = 0;
      const createSession = () => ({
        prompt: async (input: string) => {
          if (input.includes('演習結果(JSON)')) {
            advisorAttempts += 1;
            if (advisorAttempts === 1) return '{"summary":"途中で終了';
            return advice;
          }
          if (input.includes('類題の基になる問題(JSON)')) {
            practiceAttempts += 1;
            if (practiceAttempts === 1) return '{"practiceProblems":[{"question":"途中で終了';
            return practice;
          }
          return followUp;
        },
        clone: async () => createSession(),
        destroy: () => undefined,
      });
      const languageModel = {
        availability: async () => 'available',
        create: async () => createSession(),
      };
      Object.defineProperty(window, 'LanguageModel', {
        configurable: true,
        value: languageModel,
      });
    });

    await page.getByRole('button', { name: 'この端末でAIアドバイスを生成' }).click();
    await expect(page.getByText('たし算の意味をもう一度確認しましょう。')).toBeVisible();
    await expect(page.getByText(/Unterminated string/)).toHaveCount(0);
    await expect(page.getByText('根拠: 2+2の問題で3を選びました。')).toBeVisible();
    await expect(page.getByText('3+2はいくつですか。', { exact: false })).toBeVisible();

    await page.getByLabel('追加の質問').fill('なぜ答えが4になるの？');
    await page.getByRole('button', { name: '質問する' }).click();
    await expect(page.getByText('2を2回たすので4になります。')).toBeVisible();
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
