# Project Guidelines — math.app

このドキュメントは、本プロジェクトに携わるすべてのAIエージェント（Antigravity, Gemini, Claude Code 等）および開発者が遵守すべき共通のルールとプロジェクトの概要を定義します。

## 1. プロジェクト概要

中学生向け数学学習 Web アプリケーション。単元ごとの演習ドリル、スコア・経験値システム、ランキング機能を提供する。Firebase + Next.js 構成で、Cloud Functions がスコア処理のすべてを担う。

- **本番 URL**: [https://math-app-sooty.vercel.app/](https://math-app-sooty.vercel.app/)
- **Firebase プロジェクト**: `math-app-26c77`（Blaze プラン）

### 技術スタック

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

## 2. ディレクトリ構成とデータ構造

### ディレクトリ構成
```
math.app/
├── src/app/               # App Router 画面定義
├── src/components/        # コンポーネント（UI, MathDisplay等）
├── src/lib/               # ユーティリティ、Firebase設定
├── functions/src/         # Cloud Functions（プロセス重要ロジック）
├── firestore.rules        # Firestore セキュリティルール
├── .agents/               # AIエージェント用スキル・ワークフロー
└── data/                  # 問題データ (CSV等)
```

### 主要 Firestore コレクション
- `users/{uid}`: ユーザープロファイル、XP、レベル、統計
- `units/{unitId}`: 単元データ、問題リスト
- `leaderboards/overall`: 全体ランキングキャッシュ
- `suspicious_activities`: 不審な操作ログ

---

## 3. 開発・運用ルール

### セキュリティの原則 (CRITICAL)
> [!IMPORTANT]
> **Firestore セキュリティルール** は生命線です。学生によるデータの直接書き換えを厳格に防ぎます。
- **直接書き込み禁止**: `users` (XP等), `scores`, `stats` へのクライアントからの直接書き込みは禁止。
- **Functions 経由**: データ更新は必ず Cloud Functions (`processDrillResult`) を経由させる。
- **ルール変更時の義務**: `firestore.rules` を変更した場合は、必ず `tests/firestore.rules.spec.ts` にテストを追加し、`npm run test:security` を実行すること。

### 信頼境界
- スコア計算はクライアント側で行うが、Functions 側で `Math.min(100, Math.max(0, ...))` にクランプし、二重送信防止（`attemptId` 固定）を実施する。

---

## 4. 開発コマンド・デプロイ

### 主要コマンド
```bash
npm run dev           # 開発サーバー
npm test              # ユニットテスト
npm run test:security # Firestore ルールテスト
npm run test:e2e      # Playwright E2Eテスト
cd functions && npx tsc --noEmit # Functions 型チェック
```

### デプロイフロー
1. **GitHub push (main)** → Vercel 自動デプロイ（フロントエンド）。
   - `pre-push` フックが自動でパッチバージョンを上げます。
2. **Firebase deploy** (手動実施必須)
   - `firebase deploy --only functions`
   - `firebase deploy --only firestore:rules`

---

## 5. コーディング規約

- **コンポーネント**: `'use client'` は最小限に。Server Component を優先。
- **UI設計**: `vercel-react-best-practices` および `vercel-composition-patterns` に従い、パフォーマンスと保守性を高める。
- **エラーハンドリング**: Cloud Functions では `functions.https.HttpsError` を使用。
- **型定義**: `any` の使用は最小限にする。

---

## 6. AIエージェント向け指示

### 自動トリガー
- `*.csv` ファイル（数学問題）を扱う際は、必ず `.agents/skills/math-csv-check` を実行して数学的整合性をチェックすること。
- Firebase関連の変更は `.agents/skills/firebase-best-practices` を、セキュリティ関連は `.agents/skills/security-audit` を参照すること。

---

## 7. デプロイ前チェックリスト
デプロイ前にはエミュレータまたはステージングで以下を確認すること。
1. 生徒アカウントでログインし、自分のXP・ランキングが正常に表示されるか。
2. ドリル完了後にスコアとXPが正しく保存され、ランキングに反映されるか。
3. 他人のプロフィール読み取りで権限エラー（暗黙の保護）が正しく機能しているか。
