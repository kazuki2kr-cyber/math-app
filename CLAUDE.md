# CLAUDE.md — math.app

本ドキュメントは Claude Code 向けの設定ファイルです。
プロジェクト全体の共通ガイドライン、技術スタック、セキュリティルールについては必ず以下を参照してください。

👉 **[GUIDELINES.md](file:///.agents/GUIDELINES.md)**

---

## 1. プロジェクト概要 (要約)
中学生向け数学学習 Web アプリ。Firebase + Next.js 構成。
- **本番 URL**: [https://math-app-sooty.vercel.app/](https://math-app-sooty.vercel.app/)
- **Firebase プロジェクト**: `math-app-26c77`

---

## 2. カスタムスラッシュコマンド

`.claude/commands/` に以下のコマンドをインストール済み。

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

## 3. 自動発動ルール

以下の操作を行う場合、対応するスキルを必ず先に呼び出すこと。

| トリガー条件 | 使用スキル |
|------------|-----------|
| `*.csv` ファイルを読み込んで数学問題データをチェック・修正する操作 | `/tools:math-csv-check` |

---

## 4. 開発コマンド
詳細は `GUIDELINES.md` を参照。
```bash
npm run dev           # 開発サーバー
npm test              # ユニットテスト
npm run test:security # セキュリティテスト
```

---

## 5. 注意事項
- `package.json` の version は pre-push フックが自動管理。手動で変更しない。
- Firestore への書き込みは原則 Cloud Functions 経由。
