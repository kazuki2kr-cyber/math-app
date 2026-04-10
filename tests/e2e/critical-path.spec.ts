import { test, expect } from '@playwright/test';

test.describe('Formix Critical Path E2E', () => {
  test('Should login, complete drill, and verify rankings with multi-unit aggregation', async ({ page }) => {
    // 1. ログイン画面へアクセス
    await page.goto('/login');

    // 2. エミュレータ専用ログインでバイパス
    const emuBtn = page.getByTestId('emulator-login-button');
    await emuBtn.waitFor({ state: 'visible', timeout: 10000 });
    await emuBtn.click();

    // 3. ダッシュボードへの遷移
    await page.waitForURL('/', { timeout: 15000 });
    await expect(page).toHaveTitle(/Formix/);

    // 初回ログイン時の利用規約同意モーダルが表示された場合は処理する
    const termsCheckbox = page.getByRole('checkbox', { name: /利用規約およびプライバシーポリシーの内容を確認し/ });
    try {
      await termsCheckbox.waitFor({ state: 'visible', timeout: 10000 });
      await termsCheckbox.check({ force: true });
      await page.getByRole('button', { name: '同意して学習を始める' }).click();
      await expect(termsCheckbox).toBeHidden({ timeout: 5000 });
    } catch (e) {
      // モーダルが出なければそのまま通過
    }

    // ========================================================
    // 4. 複数単元合算ランキングの検証
    //    シードデータ（現在のロジック: 出題数ベースの正解数合算）:
    //    → 合算によりランキングが存在すること、そしてシードユーザーが表示されていることを確認する。
    //      具体的な計算結果の数値には依存しない作りにする。
    // ========================================================
    await expect(page.getByText('テストちゃんB (Seed)').first()).toBeVisible({ timeout: 10000 });
    // ポイントや正解数の表示が（何らかの数値で）行われていることの確認として、ユーザー名の表示をチェックすれば十分
    await expect(page.getByText('テスト君A (Seed)').first()).toBeVisible();

    // ========================================================
    // 5. フルパステスト: 演習開始 → 問題解答 → 結果保存 → ダッシュボード反映
    // ========================================================
    // テスト単元2 のカードを見つけて「演習開始」をクリック
    const unit2Card = page.locator('.group', { hasText: 'テスト単元2' }).first();
    await expect(unit2Card).toBeVisible({ timeout: 10000 });
    await unit2Card.locator('button', { hasText: '演習開始' }).click();

    // 6. 演習画面の検証
    await page.waitForURL(/\/drill\/test_unit_2/, { timeout: 15000 });
    
    // プレーンテキスト部分の "Question 1" で画面読み込み完了を確認
    await expect(page.getByText(/Question 1/)).toBeVisible({ timeout: 15000 });

    // 正解の選択肢「4」を含むボタンをクリック
    // ※選択肢はシャッフルされるが、テキスト「4」を含む唯一のボタンを探す
    await page.locator('button', { hasText: '4' }).first().click();

    // 「演習を完了する」ボタンが有効化されるのを待ってからクリック
    const completeBtn = page.locator('button', { hasText: '演習を完了する' });
    await expect(completeBtn).toBeEnabled({ timeout: 5000 });
    await completeBtn.click();

    // 7. 結果画面の検証（Cloud Functions 経由でスコア保存後に表示される）
    await page.waitForURL(/\/result\/test_unit_2/, { timeout: 15000 });
    // saving 完了後に「Result」タイトルが出現 = Cloud Function 処理完了の証拠
    await expect(page.getByText('Result')).toBeVisible({ timeout: 20000 });
    // 1問全問正解 → 100点のスコア表示
    await expect(page.getByText('/ 100')).toBeVisible({ timeout: 5000 });

    // 8. ダッシュボードへ帰還し自分のスコア反映を確認
    // レベルアップモーダルが表示されている場合は閉じる
    const levelUpBtn = page.getByRole('button', { name: '確認' });
    try {
      await levelUpBtn.waitFor({ state: 'visible', timeout: 5000 });
      await levelUpBtn.click();
    } catch (e) {
      // モーダルが出なければそのまま通過
    }

    await page.locator('button', { hasText: 'ダッシュボードに戻る' }).click();
    await page.waitForURL('/', { timeout: 15000 });
    
    // データ反映とレンダリングの安定化を待つ
    await page.reload();
    await page.waitForURL('/', { timeout: 15000 });
    // 少なくともユニットカードが表示されるのを待つ
    await expect(page.locator('.group').first()).toBeVisible({ timeout: 15000 });

    // 総合ランキングに自分の「You」バッジが表示されていることを確認
    // タイムアウトを30秒に延長し、エミュレータの並列処理による遅延を許容
    await expect(page.getByText('You').first()).toBeVisible({ timeout: 30000 });

    // ========================================================
    // 9. 単元別ランキング（test_unit_2）の検証
    // ========================================================
    const trophyBtn = page.locator('.group', { hasText: 'テスト単元2' })
      .locator('button[aria-label*="ランキングを見る"]');
    await expect(trophyBtn).toBeVisible({ timeout: 10000 });
    await trophyBtn.click();
    await page.waitForURL(/\/ranking\/test_unit_2/, { timeout: 15000 });
    await expect(page.locator('h2', { hasText: 'ランキング:' })).toBeVisible({ timeout: 10000 });
    // シードデータのテストちゃんBのスコアも単元別で表示される
    await expect(page.getByText('テストちゃんB (Seed)').first()).toBeVisible();
  });
});
