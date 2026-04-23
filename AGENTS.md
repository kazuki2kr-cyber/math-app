# AGENTS.md — math.app

本ドキュメントは Codex 向けの設定ファイルです。
Codex は作業開始時に、まず本ファイルと `.agents/GUIDELINES.md` を参照し、以後の出力・レビュー・編集方針をそれに合わせてください。

👉 **[GUIDELINES.md](file:///.agents/GUIDELINES.md)**

---

## 1. このファイルの役割

- `AGENTS.md`: Codex 向けの入口。優先順位、参照先、Codex での運用を定義する
- `.agents/GUIDELINES.md`: すべての AI エージェント共通の開発ルール・技術スタック・セキュリティ原則
- `.codex/commands/`: Codex が参照するためのコマンド定義集。既存の Claude 用運用と同じ内容を Codex からも辿れるようにしたもの
- `.agents/skills/`: 自動発動・明示利用するスキル群

Codex は、個別指示がない限り次の優先順位で判断してください。

1. ユーザーの明示指示
2. この `AGENTS.md`
3. `.agents/GUIDELINES.md`
4. 関連する `.codex/commands/*` と `.agents/skills/*`

---

## 2. プロジェクト概要 (要約)

中学生向け数学学習 Web アプリ。Firebase + Next.js 構成。

- **本番 URL**: [https://math-app-sooty.vercel.app/](https://math-app-sooty.vercel.app/)
- **Firebase プロジェクト**: `math-app-26c77`

---

## 3. Codex での基本運用

- 変更前に関連ファイルを読み、既存実装・既存ルールとの整合を確認する
- Firestore / Cloud Functions / セキュリティルールを触る場合は、共通ガイドと関連スキルを必ず先に確認する
- Cloud Functions をデプロイする際は、原則 `firebase deploy --only functions:<name>` 形式で**必要な関数だけ個別デプロイ**する
- `firebase deploy --only functions` のような一括デプロイは、ユーザーの明示指示がある場合を除き避ける
- `recognizeKanjiBatch` は漢字モードの重要関数として扱い、漢字OCR対応の明示依頼がない限りデプロイ対象に含めない
- `recognizeKanjiBatch` を含む変更やデプロイが必要な場合は、まず `main` ブランチの実装を基準に差分確認し、`main` と同等の形を維持する
- レビュー依頼では、要約より先にリスク・不具合・回帰可能性を列挙する
- 可能な限りテストまたは検証を実施し、未実施なら理由を明記する
- `.codex/commands/` の文書が参照された場合は、Claude 用と同じ意図のワークフローとして扱う

---

## 4. Codex 用コマンド参照

Codex は Claude のスラッシュコマンドをそのまま実行するわけではありませんが、同名の参照ドキュメントを `.codex/commands/` に用意しています。
該当タスクでは、その文書の手順・観点・出力期待を踏まえて作業してください。

### セキュリティ・品質

| コマンド | 用途 |
|---------|------|
| `/tools:security-scan` | セキュリティ脆弱性スキャン |
| `/tools:deps-audit` | 依存パッケージの脆弱性チェック |
| `/dev:code-review` | コードレビュー |
| `/dev:fix-issue` | バグ修正ガイド |
| `/tools:math-csv-check` | 数学問題CSVの数学的表現チェック＆修正 |

### デプロイ・リリース

| コマンド | 用途 |
|---------|------|
| `/tools:deploy-checklist` | デプロイ前チェックリスト |
| `/deploy:prepare-release` | リリース準備・バージョニング |

### 開発ワークフロー

| コマンド | 用途 |
|---------|------|
| `/tools:debug-trace` | 系統的なデバッグ手順 |
| `/dev:debug-error` | エラー原因分析 |
| `/tools:db-migrate` | Firestore スキーマ変更手順 |
| `/workflows:full-stack-feature` | フルスタック機能開発フロー |
| `/workflows:feature-development` | 機能開発ワークフロー |
| `/workflows:tdd-cycle` | TDD サイクル実行 |

---

## 5. 自動発動ルール

以下の操作を行う場合、対応するスキルまたは参照文書を必ず先に確認すること。

| トリガー条件 | 使用スキル / 参照先 |
|------------|---------------------|
| `*.csv` ファイルを読み込んで数学問題データをチェック・修正する操作 | `.agents/skills/math-csv-check` および `.codex/commands/tools/math-csv-check.md` |
| Firebase / Firestore / Cloud Functions の設計・変更 | `.agents/skills/firebase-best-practices` |
| セキュリティレビュー、権限、脆弱性確認 | `.agents/skills/security-audit` および `.codex/commands/tools/security-scan.md` |

---

## 6. スキル運用ルール

このプロジェクトでは、Codex は次の順序でスキルを使い分けてください。

1. まずリポジトリ同梱の `.agents/skills/*` を優先する
2. 不足する観点だけを Codex グローバルスキルで補う
3. 複数スキルが該当する場合は、最小構成で使う

### 共通スキル資産

以下は他AIでも実質共通で使っているリポジトリ内スキルであり、Codex でも同様に利用する。

- `math-csv-check`: 数学問題 CSV の検証・修正時に必須
- `firebase-best-practices`: Firestore / Cloud Functions / 権限設計の変更時に必須
- `security-audit`: セキュリティレビュー、認可、デプロイ前確認で優先
- `pdf-to-math-csv`: PDF から数学問題 CSV を生成する場合
- `kanji-csv-creation`: 漢字問題の CSV 化を行う場合
- `metrics-dashboard`: KPI やダッシュボード設計を行う場合
- `cohort-analysis`: コホート分析を行う場合
- `ab-test-analysis`: A/B テスト分析を行う場合
- `gsap-react`: React / Next.js で GSAP アニメーションを扱う場合

### Codex 補助スキル

以下は Codex 用に導入・利用する補助スキル。リポジトリ固有スキルを置き換えるのではなく、足りない観点を補う目的で使う。

- `frontend-skill`: ランディングページ、強いビジュアル設計、UI のアートディレクションが主題のときに使う
- `security-best-practices`: JavaScript / TypeScript / Next.js / React の一般的なセキュリティベストプラクティス確認が必要なときに使う

### Codex での具体的な使い分け

- 通常のフロント実装: まず既存実装と `GUIDELINES.md` を優先し、必要なら `frontend-skill` を補助利用する
- React アニメーション: `gsap-react` を優先し、見た目の完成度が重要なら `frontend-skill` も併用する
- Firebase 変更: `firebase-best-practices` を必須、セキュリティ懸念が強い場合は `security-audit` も併用する
- セキュリティ診断: まず `security-audit`、必要に応じて `security-best-practices` の Next.js / React / general web security 観点を追加する
- CSV / PDF 系データ整備: 対応する repo スキルを必ず優先し、グローバルスキルでは代替しない

---

## 7. 開発コマンド

詳細は `GUIDELINES.md` を参照。

```bash
npm run dev           # 開発サーバー
npm test              # ユニットテスト
npm run test:security # セキュリティテスト
npm run test:e2e      # E2E テスト
cd functions && npx tsc --noEmit
```

---

## 8. 注意事項

- `package.json` の version は pre-push フックが自動管理。手動で変更しない
- Firestore への書き込みは原則 Cloud Functions 経由
- `firestore.rules` を変更した場合は、関連テスト追加と `npm run test:security` を必須とする
