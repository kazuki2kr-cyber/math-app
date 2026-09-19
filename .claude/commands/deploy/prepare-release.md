# Prepare Release — math.app

1. `git diff` と `git status` で対象差分を確定する。
2. `.github/workflows/quality.yml` と同等の標準ゲートが成功していることを確認する。
3. 変更範囲に応じて E2E または機能固有ゲートを一度だけ追加する。
4. フロント、Functions、Firestoreルール、Realtime Databaseルールのデプロイ対象を分ける。
5. Firebase は常に `--project math-app-26c77` と `--only` を指定する。
6. デプロイ後は、自動テストで覆えない箇所だけをスモーク確認する。

`package.json` の version は main ブランチ上の pre-commit フックが管理するため手動変更しない。`npm audit fix`、依存更新、タグ作成、ブランチ作成はリリース準備へ暗黙に含めず、必要な場合だけ別タスクとして実施する。
