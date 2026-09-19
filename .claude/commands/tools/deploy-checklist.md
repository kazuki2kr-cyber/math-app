# Deployment Checklist — math.app

デプロイ対象の差分を確認し、変更範囲に応じて必要なゲートだけを一度ずつ実行する。

## 標準ゲート

```bash
npm test
npm run lint
npm run build
npm --prefix functions run build
```

- `npm test` はエミュレータ不要のユニットテストと Firestore ルールテストを順番に実行する。
- `npm run lint` はエラー0を必須とし、動的なFirebaseデータ境界に残る `any` は警告として継続管理する。
- ブラウザのクリティカルパスに影響する場合だけ `npm run test:e2e:emu` を追加する。
- `firestore.rules` 変更時は対応するルールテスト追加を必須とする。
- Functions、Firestoreルール、Realtime Databaseルールは `--project math-app-26c77` と `--only` で対象を明示する。

## 機能固有ゲート

- 漢字対戦: `npm run test:kanji-battle`。ブラウザフロー変更時は `npm run test:kanji-battle:e2e` も実行する。
- Gemini記述式採点: `docs/written-grading-architecture.md` を読み、`npm run deploy:written-grading` を唯一の入口とする。内部テストを事前に重複実行しない。

## デプロイ後

自動テストで覆えない本番設定、外部API、新規クリティカルパスだけを短く確認する。異常時は Functions ログと外部APIのステータスを分けて調査する。
