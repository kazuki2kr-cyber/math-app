---
description: デプロイ前のセキュリティとデグレ確認フロー
---

# デプロイ前チェックフロー

デグレを防止し、アプリケーションの品質を維持するために、以下の手順を**必ず**実行してください。

## 1. 標準検証

ユニットテストと Firestore セキュリティルールテストは、集約コマンドで一度ずつ実行します。

```bash
npm test
```

- `firestore.rules` を変更した場合は、`tests/firestore.rules.spec.ts` に対応するテストを追加してください。
- ルールだけを再検証する場合は `npm run test:security` を使用してください。

## 2. 影響範囲別の追加検証

ブラウザのクリティカルパス（ログイン、ドリル、XP、ランキング）に影響する場合は、Firebase Emulator を含む E2E を実行します。

```bash
npm run test:e2e:emu
```

- 漢字対戦は `npm run test:kanji-battle`、必要に応じて `npm run test:kanji-battle:e2e` を使用します。
- 記述式採点の対象変更は `npm run deploy:written-grading` を唯一のデプロイ入口とし、内部ゲートを事前に重複実行しません。

## 3. セキュリティ監査（セルフレビュー）
変更箇所に対して、`security-audit` スキルを活用して以下の宣言・チェックを実施してください。

- **指示例**: 「デプロイ前に security-audit スキルを使って、今回の差分に脆弱性や権限設定漏れがないかチェックして」
- **確認事項**:
  - `admin` 権限などのバイパスがないか。
  - 生徒からの意図しないデータ更新リスクがないか。

## 4. デプロイ後確認

本番設定、外部API、新規クリティカルパスなど自動テストで覆えない変更だけを短くスモーク確認します。Functions の異常調査には `npm --prefix functions run logs` または Firebase Console を使います。
