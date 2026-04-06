---
name: firebase-best-practices
description: Formix (math.app) における Firebase/Firestore のセキュリティアーキテクチャおよびデータ設計のベストプラクティスを定めたスキルです。Firebaseのコード、セキュリティルール、Cloud Functionsを編集・レビューする際に使用します。
---

# Firebase Best Practices for Formix

このスキルは、生データ（XP、スコア等）の不正操作を防ぎ、Firebase環境での堅牢なシステムを構築するためのルールです。

## 1. クライアントからの直接書き込みの原則禁止 (Firestore Rules)
教育というドメインの性質上、生徒（クライアント）が自身のスコアやXPを自由に書き換えられてしまう状態は致命的なインシデント（チート）を招きます。
- `scores`, `users` コレクションのXP/スコア関連フィールドに対するクライアントからの `create`, `update`, `delete` は**原則禁止**すること。
- セキュリティルール (`firestore.rules`) により、クライアントからの書き込み可能なフィールドを厳密に制限すること。
- 必要であれば、管理画面用にカスタムクレーム (`request.auth.token.admin == true`) を持つ管理者のみが特権アクセス可能なルールを整備すること。

## 2. スコア・XP更新はCloud Functionsを経由
生徒のXP増加やスコアの保存はすべて、サーバーサイドである **Cloud Functions** (`processDrillResult` など) を経由して行うこと。
- クライアントからはAPI (Callable Function等) を呼び出し、サーバーサイドで正当性を検証した後に Firestore を更新する設計を推奨します。
- Cloud Functions では、同時リクエストによるデータの競合（トランザクション）を考慮し、必ず `runTransaction` や `FieldValue.increment()` などを活用して更新を行うこと。

## 3. インデックス要件の最適化
ダッシュボード等でランキング表示を行うためのクエリ（例: `xp` の降順指定など）を実装した場合、必ず `firestore.indexes.json` を更新し、複合インデックスを明記すること。
- Firestore のエラーログから推奨リンクを取得するだけでなく、事前にインデックス構成を設計すること。

## 4. エミュレータを用いたローカルテスト
`firestore.rules` や Cloud Functions の実装・変更を行った際は、本番環境(プレビュー環境)へデプロイする前に、**必ずFirebase Local Emulator Suite**を使用してテストをパスさせること。
- セキュリティルールの自動テスト（`tests/firestore.rules.spec.ts` 等）の実行結果をエージェント自身で確認してから、タスクを完了とすること。

## トリガー条件
- 「Firestoreルールの変更をして」
- 「XP計算部分に機能を追加して」
- 「ランキングが正しく表示されないバグを直して（Cloud Functions側の場合）」
- エージェント自身が「Firebaseの設計に触れる」と判断したあらゆるケースで自律的にこのルールを参照・遵守してください。
