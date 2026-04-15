# CLAUDE.md — math.app

## プロジェクト概要

中学生向け数学学習 Web アプリケーション。単元ごとの演習ドリル、スコア・経験値システム、ランキング機能を提供する。Firebase + Next.js 構成で、Cloud Functions がスコア処理のすべてを担う。

- **本番 URL**: Vercel（git push main で自動デプロイ）
- **Firebase プロジェクト**: `math-app-26c77`（Blaze プラン）
- **現在バージョン**: `package.json` の `version` フィールドを参照

---

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| フロントエンド | Next.js 16 (App Router), React 19, TypeScript |
| スタイリング | Tailwind CSS v4, shadcn/ui, framer-motion |
| 数式表示 | KaTeX (`react-katex`) |
| バックエンド | Firebase Cloud Functions (Node.js 20, us-central1, 1st Gen) |
| データベース | Cloud Firestore (asia-northeast1) |
| 認証 | Firebase Auth (Google サインイン) |
| ホスティング | Vercel (フロント) / Firebase Hosting (静的出力) |
| テスト | Jest (unit), Playwright (e2e), Firebase Emulator (rules) |

---

## ディレクトリ構成

```
math.app/
├── src/app/
│   ├── page.tsx               # ダッシュボード（単元一覧・ランキング・プロフィール）
│   ├── drill/[unitId]/        # 演習ドリル画面
│   ├── result/[unitId]/       # 演習結果・XP処理画面
│   ├── admin/                 # 管理者画面（問題管理・統計・メンテナンス）
│   ├── login/                 # 認証画面
│   └── layout.tsx
├── src/components/
│   ├── ui/                    # shadcn/ui コンポーネント
│   ├── MathDisplay.tsx        # KaTeX 数式レンダラー
│   └── MaintenancePage.tsx    # メンテナンスモード表示
├── src/lib/
│   ├── firebase.ts            # Firebase 初期化・クライアント設定
│   ├── xp.ts                  # XP・レベル計算ロジック（クライアント用）
│   └── utils.ts               # parseOptions など汎用ユーティリティ
├── src/contexts/
│   └── AuthContext.tsx        # Firebase Auth の React Context
├── functions/src/
│   └── index.ts               # Cloud Functions（processDrillResult, setAdminClaim, listAdmins）
├── firestore.rules            # Firestore セキュリティルール
├── firestore.indexes.json     # 複合インデックス定義
└── .husky/pre-push            # git push 時に自動バージョンバンプ
```

---

## 主要 Firestore コレクション構造

```
users/{uid}
  ├── xp, level, title, icon, totalScore
  ├── unitStats/{unitId}: { maxScore, bestTime, wrongQuestionIds, totalCorrect }
  └── attempts/{attemptId}: { unitId, score, time, date, details[] }

units/{unitId}
  ├── title, description, order
  ├── questions[]: { id, question_text, options[], answer_index, explanation, image_url }
  └── stats/questions: { [questionId]: { correct, total } }

leaderboards/overall
  └── rankings[]: { uid, name, icon, totalScore, xp, level }

stats/global
  └── totalDrills, totalCorrect, totalAnswered, totalParticipants

suspicious_activities/{id}
  └── uid, reasons[], score, time, timestamp
```

---

## 開発コマンド

```bash
# 開発サーバー起動
npm run dev

# TypeScript 型チェック（フロント）
npx tsc --noEmit

# TypeScript 型チェック（Functions）
cd functions && npx tsc --noEmit

# テスト
npm test                    # Jest ユニットテスト
npm run test:security       # Firestore ルールテスト（Emulator 必要）
npm run test:e2e            # Playwright E2E テスト
npm run test:e2e:emu        # Emulator 環境での E2E テスト

# Lint
npm run lint
```

---

## デプロイフロー

### フロントエンド（Vercel 自動デプロイ）
```bash
git push origin main
# → pre-push フック が自動で npm version patch を実行し再 push
# → Vercel が main ブランチへの push を検知して自動ビルド・デプロイ
```

### Cloud Functions（手動デプロイ必須）
```bash
firebase deploy --only functions
# フロントのデプロイとは独立している。functions/src/index.ts を変更したら必ず実行。
```

### Firestore ルール
```bash
firebase deploy --only firestore:rules
```

> **注意**: `pre-push` フックは `exit 1` で元の push をキャンセルしてバージョンバンプ後の状態で再 push する。このフック自体が失敗しても Functions のデプロイは行われない。

---

## Firebase 無料枠・コスト管理

Blaze プランだが無料枠内運用を目指す。

| リソース | 無料上限/日 | 現在の消費（1演習） | 安全な DAU 上限 |
|----------|------------|---------------------|-----------------|
| Firestore 読み取り | 50,000/日 | ~11 reads | ~2,000 |
| Firestore 書き込み | 20,000/日 | ~5.5 writes | **~1,800（律速）** |
| Cloud Functions 呼び出し | 2,000,000/月 | 1 call | 余裕あり |

**コスト最適化の原則**:
- `processDrillResult` 内で unit ドキュメントはすでに1回読んでいる（行 96-98）。追加の読み取りが必要な場合はこの結果を再利用する
- リーダーボードはスコア更新時のみ更新（ランキング閲覧時は Firestore 読み取りを追加しない）
- 管理画面の統計はクライアントキャッシュを活用する

---

## スコア・XP システムの重要な注意点

**信頼境界**: スコア計算はクライアント側で行い、Cloud Function に渡す設計。以下のセキュリティ対策が現在実施済み：

- `processDrillResult` でスコアを `Math.min(100, Math.max(0, ...))` にクランプ（v1.0.14〜）
- `attemptId` をドリル開始時に1度だけ生成し、連打時も同一 ID を使用（v1.0.14〜）
- `isCompletingRef` + `isCompleting` state による二重送信防止（v1.0.14〜）
- 不審なアクティビティは `suspicious_activities` コレクションに記録

**未対応の既知リスク（将来対応予定）**:
1. XP・スコアのサーバー側再計算（クライアント値の検証）
2. 問題 ID の実在チェック（unit ドキュメントとの照合）
3. sessionStorage を経由しない直接 API 送信
4. 回答順序をサーバーに送信してコンボを検証
5. XP gain の上限クランプ（現在は無制限）

---

## Firestore セキュリティルールの原則

- `users/{uid}/attempts` および `wrong_answers` への書き込みは Cloud Functions からのみ (`allow create, update: if false`)
- 管理者権限は Firebase Auth Custom Claims (`token.admin == true`) で管理
- `setAdminClaim` は管理者本人の権限剥奪を禁止

---

## 利用可能なカスタムスラッシュコマンド

`.claude/commands/` に以下のコマンドをインストール済み。

### セキュリティ・品質
| コマンド | 用途 |
|---------|------|
| `/tools:security-scan` | セキュリティ脆弱性スキャン |
| `/tools:deps-audit` | 依存パッケージの脆弱性チェック |
| `/dev:code-review` | コードレビュー |
| `/dev:fix-issue` | バグ修正ガイド |

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

### 組み込みスキル（Claude Code 標準）
| コマンド | 用途 |
|---------|------|
| `/commit` | 変更をコミット |
| `/review` | PR レビュー |
| `/security-review` | ブランチ上の変更をセキュリティレビュー |
| `/simplify` | コード品質・重複チェック |

---

## コーディング規約

- **コンポーネント**: `'use client'` は必要な場合のみ。Server Component を優先
- **Firestore 書き込み**: クライアントから直接書かない。Cloud Functions 経由を原則とする
- **エラーハンドリング**: Cloud Functions では `functions.https.HttpsError` を使用
- **型**: `any` の使用は最小限に。特に Cloud Function の `data as any` は改善対象
- **バージョン管理**: `package.json` の version は pre-push フックが自動管理。手動で変更しない

---

## よく使う Firebase CLI コマンド

```bash
# Emulator 起動（ローカル開発・テスト用）
firebase emulators:start

# Functions のみデプロイ
firebase deploy --only functions

# Firestore ルールのみデプロイ
firebase deploy --only firestore:rules

# ログ確認（直近100件）
firebase functions:log --limit 100

# Functions ログリアルタイム確認
firebase functions:log --follow
```
