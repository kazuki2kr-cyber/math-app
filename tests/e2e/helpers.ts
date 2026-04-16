import { Page } from '@playwright/test';

/**
 * エミュレータテストユーザー (test@shibaurafzk.com) でログインし、
 * ダッシュボードに遷移するまで待機する。
 * 利用規約モーダルが表示された場合は自動で同意する。
 */
export async function loginAsTestUser(page: Page): Promise<void> {
  await page.goto('/login');
  const emuBtn = page.getByTestId('emulator-login-button');
  await emuBtn.waitFor({ state: 'visible', timeout: 10000 });
  await emuBtn.click();
  await page.waitForURL('/', { timeout: 15000 });
  await dismissTermsModal(page);
}

/**
 * エミュレータ管理者ユーザー (admin@shibaurafzk.com) でログインし、
 * ダッシュボードに遷移するまで待機する。
 * global-setup.ts でカスタムクレーム (admin: true) が設定済みであること。
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  const adminBtn = page.getByTestId('emulator-admin-login-button');
  await adminBtn.waitFor({ state: 'visible', timeout: 10000 });
  await adminBtn.click();
  await page.waitForURL('/', { timeout: 15000 });
  await dismissTermsModal(page);
}

/**
 * レベルアップモーダルが表示されている場合に閉じる。
 */
export async function dismissLevelUpModal(page: Page): Promise<void> {
  try {
    const confirmBtn = page.getByRole('button', { name: '確認' });
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
    await confirmBtn.click();
  } catch {
    // モーダルが表示されていなければ無視
  }
}

/**
 * 利用規約モーダルが表示されている場合に同意して閉じる。
 */
async function dismissTermsModal(page: Page): Promise<void> {
  try {
    const termsCheckbox = page.getByRole('checkbox', {
      name: /利用規約およびプライバシーポリシーの内容を確認し/,
    });
    if (await termsCheckbox.isVisible({ timeout: 3000 })) {
      await termsCheckbox.click({ force: true });
      const agreeBtn = page.getByRole('button', { name: '同意して学習を始める' });
      await agreeBtn.waitFor({ state: 'visible' });
      await agreeBtn.click();
      await page.waitForURL('/', { timeout: 10000 });
    }
  } catch {
    // モーダルが表示されていなければ無視
  }
}

/**
 * 指定ユニットのドリルを完了する汎用ヘルパー。
 *
 * @param page - Playwright の Page オブジェクト
 * @param unitCardText - ユニットカードに表示されるタイトルテキスト
 * @param answers - 問題ごとに選択するボタンテキストの配列（問題数分）
 */
export async function completeDrill(
  page: Page,
  unitCardText: string,
  answers: string[]
): Promise<void> {
  // ユニットカードから演習開始
  const unitCard = page.locator('.group', { hasText: unitCardText }).first();
  await unitCard.locator('button', { hasText: '演習開始' }).click();

  const unitId = encodeURIComponent(
    unitCardText === 'テスト単元' ? 'test_unit'
    : unitCardText === 'テスト単元2' ? 'test_unit_2'
    : unitCardText === 'テスト複数問題単元' ? 'test_unit_multi'
    : unitCardText
  );

  await page.waitForURL(new RegExp(`/drill/`), { timeout: 15000 });
  await page.getByText(/Question 1/).waitFor({ timeout: 15000 });

  for (let i = 0; i < answers.length; i++) {
    await page.locator('button', { hasText: answers[i] }).first().click();

    if (i < answers.length - 1) {
      // 最後以外は「次の問題へ」をクリック
      await page.locator('button', { hasText: '次の問題へ' }).click();
    } else {
      // 最後の問題は「演習を完了する」
      const completeBtn = page.locator('button', { hasText: '演習を完了する' });
      await completeBtn.waitFor({ state: 'visible' });
      await completeBtn.click();
    }
  }

  await page.waitForURL(/\/result\//, { timeout: 15000 });
  await page.getByText('Result').waitFor({ timeout: 20000 });
}
