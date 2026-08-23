# Formix 週次プロダクトレビュー用データ

毎週の Codex automation が、同じ期間・同じ定義の学習集計と匿名化済みフィードバックを参照するための読み取り専用JSONを生成します。

## 実行

```powershell
npm.cmd run automation:weekly-snapshot
```

認証と読み取り権限だけを安全に確認する場合（トークンや秘密値は表示しません）:

```powershell
npm.cmd run automation:weekly-snapshot -- --check-auth
```

既定の出力先は `.local/automation/formix-weekly-snapshot.json` です。`.local/` はGit管理外です。誤上書きを防ぐため、`--output` も `.local/automation/` 以下だけを受け付けます。

基準日や出力先を固定する場合:

```powershell
npm.cmd run automation:weekly-snapshot -- --as-of 2026-08-07 --output .local/automation/formix-weekly-snapshot.json
```

読み取りは `.env.local` の `NEXT_PUBLIC_FIREBASE_API_KEY`、`TEST_USER_EMAIL`、`TEST_USER_PASSWORD` で管理者としてFirebase Authへログインし、Firestoreセキュリティルールを通す経路を優先します。これらが利用できない場合だけ、Application Default Credentials、または `GOOGLE_APPLICATION_CREDENTIALS` の認証情報を予備経路として使用します。秘密値や鍵ファイルをリポジトリへ保存しないでください。予備経路の認証主体には本プロジェクトで承認された読み取り専用権限を使用し、編集者・所有者権限をautomation用途に付与しないでください。

## データ境界

- 学習KPIは匿名化済みの `public_analytics_serving/current` だけを参照します。
- フィードバックは `user_feedback` と `written_grading_feedback` の実行日を含む直近7日分だけを読みます。
- `uid`、氏名、メール、端末情報、ドキュメントID、問題ID、attempt ID、個人成績はJSONへ出力しません。
- 自由記述内の既知の氏名・メール・UID、電話番号、URL、長い識別子を `[非表示]` に置換します。
- ページURLは `/drill` などの大分類だけを残します。
- ファイルは一時ファイルから置き換えるため、途中まで書かれたJSONをautomationが読むことを防ぎます。

自由記述の機械的な匿名化には限界があります。JSONは管理者向けの内部資料として扱い、生徒へそのまま公開しないでください。

## 指標定義

- `currentPeriod`: 日本時間で基準日を含む直近7暦日
- `previousPeriod`: `currentPeriod` の直前7暦日
- `totalAttempts`: 完了した演習数。問題回答数ではありません
- `activeLearnerDays`: 日別ユニーク学習者数の合計。週次ユニーク学習者数ではありません
- `uniqueLearners`: 対象7日間に演習を完了した重複なしの学習者数。BigQueryで7日窓を直接集計し、5人未満なら出力しません
- `latestAnswerMasteryRate`: 対象期間の生徒×単元×問題ごとの最新回答が正解だった割合。永続的な習熟を断定しない代理指標です
- `nextItemCorrectness.rateAfterError`: 同一演習内で誤答した直後の問題に正解した割合。AIチューターやヒントの効果測定ではありません
- `avgAccuracy`: 日次集計に正答数・回答数があればその合計から算出し、なければ日次正答率のattempt加重平均を使います
- `categoryCoverage`: 週次全体のうち、5人以上の匿名化条件を満たしてカテゴリ別に表示できた演習の割合と、表示できない残数です

週次指標は `report_trends/current.weeklyPeriods`、カテゴリ週次指標は各 `report_categories/*/trends.weeklyPeriods` の匿名化済み集計を優先します。カテゴリは単元メタデータ、イベント記録、「その他」の順で帰属を補完します。日別行は5人未満の日を抑制するため、週次合計や週次ユニーク数を日別行から復元しません。カテゴリごとの週次ユニーク学習者が5人未満なら、そのカテゴリ行は非表示のままです。

一部のデータを取得できない場合も `status: "partial"` のJSONを生成し、`errors` に秘密情報を含まない原因を記録します。取得失敗を終了コードでも検知したい場合は `--strict` を付けてください。

`http_400` で認証に失敗する場合は、値を画面やログへ表示せず `.env.local` の `NEXT_PUBLIC_FIREBASE_API_KEY`、`TEST_USER_EMAIL`、`TEST_USER_PASSWORD` を再設定してください。`TEST_USER_EMAIL` の利用者には管理者カスタムクレームが必要です。
