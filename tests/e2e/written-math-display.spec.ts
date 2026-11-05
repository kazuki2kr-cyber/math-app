import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers';

test('記述式の結果画面で空白と改行を含む連立方程式を表示する', async ({ page }) => {
  await loginAsTestUser(page);
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
  // Exercise the real result UI with a fixed grading response, without calling AI.
  await page.route('**/submitWrittenDrillResult', async route => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    await route.fulfill({ headers, json: { result: {
      success: true, score: 80, xpGain: 0, remainingAttempts: 1,
      grading: {
        score: 80, detectedAnswer: '\\(x=220, y=80\\)',
        transcription: 'ノートをx円、消しゴムをy円とする。\n\\[\n\\begin{cases}8x+3y=2000 \\\\ \\frac{7}{10}x \\times 10 + \\frac{1}{2}y \\times 4=1700\\end{cases}\n\\]\n$$\n7x+2y=1700\n$$\nよって、ノートは220円。',
        feedback: '式の立て方を確認しましょう。', improvementPoints: [], rubricScores: [],
      },
    } } });
  });
  await page.route('**/recordWrittenResultExposure', route => route.fulfill({ headers, json: { result: { success: true } } }));
  await page.evaluate(() => sessionStorage.setItem('drillResult', JSON.stringify({
    type: 'written', attemptId: 'math-display-regression', unitId: 'test_unit',
    unitTitle: '数式表示テスト', questionId: 'display-only', questionText: '連立方程式を立てなさい。',
    totalQuestions: 1, time: 30,
    answerImageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9uoAAAAASUVORK5CYII=',
  })));
  await page.goto('/result/test_unit');
  const answer = page.getByText('AIが読み取った答案', { exact: true }).locator('..');
  await expect(answer).toBeVisible();
  await expect(answer.locator('.katex-display')).toHaveCount(2);
  await expect(answer.locator('.katex-error')).toHaveCount(0);
  await expect(answer).toContainText('よって、ノートは220円。');
  await expect(answer.locator('annotation').first()).toContainText('8x+3y=2000');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(answer).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
