# 記述式採点アーキテクチャとリリースゲート

## データフロー

1. クライアントは答案画像と固定済み `attemptId` を `submitWrittenDrillResult` へ送る。
2. Cloud Functions が問題、提出上限、答案状態を検証する。
3. Gemini `generateContent` APIへ答案画像、採点基準、JSON Schemaを送る。
4. Functionsが応答を正規化し、総合点と観点合計を一致させる。
5. Firestoreトランザクションで答案、XP、分析イベントを確定する。

## 不変条件

- Geminiへの現行エンドポイントは `v1beta/models/*:generateContent`。
- JSON出力指定には `generationConfig.responseMimeType` と `responseJsonSchema` を使う。
- `responseFormat` は別API世代との互換性問題があるため、この経路では使用しない。
- 観点得点は各 `maxScore` 以下で、合計は総合点と一致させる。
- AI採点失敗時は `grading_failed` とし、提出回数を消費せず同じ `attemptId` で再試行できる。
- Schema設定だけが400で拒否された場合は、`responseMimeType` のみで一度再試行する。認証、画像、レート制限など別種のエラーにはフォールバックしない。

## 変更時の必須検証

Geminiのモデル、エンドポイント、`generationConfig`、JSON Schema、応答解析を変更する場合は、下記の専用デプロイスクリプトを唯一の入口とする。スクリプトが単体テスト、Functions build、Gemini実APIスモークを実行し、Firebase predeploy がbuildと契約チェックを再確認するため、内部コマンドを事前に重複実行しない。

`smoke:written-grading-api` は `functions/.env` の秘密値を表示せず、実APIが現在のリクエスト形式を受理することを確認する。ネットワークや認証を使うため、単体テストの代替にはせず、デプロイ直前の契約確認として実行する。

## デプロイ

記述式採点Functionは、必要なゲートを順番に実行する専用スクリプトからデプロイする。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-written-grading.ps1
```

デプロイ後は、Functionの更新成功だけで完了とせず、テスト用答案を1件提出して結果画面まで確認する。失敗時はFunctionログを確認し、外部APIの400、401、403、429とアプリ内部エラーを区別する。
