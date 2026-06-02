# Project Guidelines — math.app

このドキュメントは、本プロジェクトに携わるすべてのAIエージェント（Antigravity, Gemini, Claude Code 等）および開発者が遵守すべき共通のルールとプロジェクトの概要を定義します。

## 1. プロジェクト概要

中学生向け数学学習 Web アプリケーション。単元ごとの演習ドリル、スコア・経験値システム、ランキング機能、漢字モード、リアルタイム対戦、管理者向け分析を提供する。Firebase + Next.js 構成で、Cloud Functions がスコア処理や集計更新などの信頼境界を担う。

- **本番 URL**: [https://math-app-sooty.vercel.app/](https://math-app-sooty.vercel.app/)
- **Firebase プロジェクト**: `math-app-26c77`（Blaze プラン）

### 技術スタック

| レイヤー | 技術 |
|----------|------|
| フロントエンド | Next.js 16 (App Router), React 19, TypeScript |
| スタイリング | Tailwind CSS v4, shadcn/ui, framer-motion |
| 数式表示 | KaTeX (`react-katex`) |
| バックエンド | Firebase Cloud Functions (Node.js 22, us-central1, 1st Gen / `firebase-functions/v1`) |
| データベース | Cloud Firestore (asia-northeast1), Firebase Realtime Database (対戦ルーム) |
| 認証 | Firebase Auth (Google サインイン) |
| ホスティング | Vercel (フロントエンド)。`firebase.json` に Hosting 設定は残っているが、現行の Next.js 設定は静的 `out` 出力ではない |
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
├── scripts/               # 運用・移行・シード・監査スクリプト、漢字CSV
├── docs/                  # 分析仕様などの補助ドキュメント
├── 問題PDFデータ/         # 数学問題PDF
└── *.csv                  # ルート直下の数学問題CSV
```

### 主要 Firestore コレクション
- `users/{uid}`: ユーザープロファイル、XP、レベル、統計
- `users/{uid}/attempts/{attemptId}`: 演習ごとの軽量記録。`expireAt` による削除対象
- `units/{unitId}`: 単元データ、問題リスト
- `leaderboards/overall`, `leaderboards/kanji`, `leaderboards/kanjiSeason1`: ランキング・シーズン記録
- `suspicious_activities`: 不審な操作ログ
- `user_feedback`: アプリ内フィードバック
- `analytics_events`: BigQuery 連携用の演習イベントログ
- `analytics_serving/*`: 管理画面向けの集計済み分析データ
- `battle_results`, `kanji_battle_results`, `kanji_battle_ocr`: 対戦・漢字対戦の確定結果や冪等性管理

### 主要 Realtime Database パス
- `battleRooms/{roomId}`: 数学対戦ルーム
- `kanjiBattleRooms/{roomId}`: 漢字対戦ルーム

---

## 3. 開発・運用ルール

### セキュリティの原則 (CRITICAL)
> [!IMPORTANT]
> **Firestore セキュリティルール** は生命線です。学生によるデータの直接書き換えを厳格に防ぎます。
- **直接書き込み禁止**: `users` のXP・スコア・統計、`stats`、`analytics_events` など信頼境界内のデータをクライアントから直接書き換えない。旧 `scores` コレクションは互換・参照用途が残るが、新規の成績更新は `users/{uid}/unitStats` と `users/{uid}/attempts` を中心に扱う。
- **Functions 経由**: 数学ドリルの成績更新は `processDrillResult`、漢字ドリルは `submitKanjiDrillResult`、対戦の確定処理は `finalizeBattleRoom` / `finalizeKanjiBattleRoom` を経由させる。
- **ルール変更時の義務**: `firestore.rules` を変更した場合は、必ず `tests/firestore.rules.spec.ts` にテストを追加し、`npm run test:security` を実行すること。

### 信頼境界
- クライアントは選択肢・回答・時間・演習モードだけを送信し、正誤判定、スコア、XP、ランキング反映は Cloud Functions 側で再計算する。
- 数学ドリルのスコアは `mode` により異なる。`standard` / `wrong` は正解1問あたり10点、`all` は正答率ベース。復習モードも解いた問題数ぶんだけスコア・XP・集計に反映する。
- 二重送信防止は演習開始時に固定した `attemptId` と `users/{uid}/attempts/{attemptId}` で実施する。

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

Windows PowerShell で `npm.ps1` の実行ポリシーに当たる場合は `npm.cmd` を使う。

### デプロイフロー
1. **GitHub push (main)** → Vercel 自動デプロイ（フロントエンド）。
   - `pre-push` フックが自動でパッチバージョンを上げます。
2. **Firebase deploy** (Functions / ルールは手動実施)
   - `.firebaserc` に既定プロジェクトが入っていない環境では `--project math-app-26c77` を付ける
   - `firebase deploy --project math-app-26c77 --only functions`
   - `firebase deploy --project math-app-26c77 --only firestore:rules,database`

---

## 5. コーディング規約

- **コンポーネント**: `'use client'` は最小限に。Server Component を優先。
- **UI設計**: `vercel-react-best-practices` および `vercel-composition-patterns` に従い、パフォーマンスと保守性を高める。
- **エラーハンドリング**: Cloud Functions では `functions.https.HttpsError` を使用。
- **型定義**: `any` の使用は最小限にする。
- **文字コード**: ソース、Markdown、CSV、設定ファイルは原則 UTF-8 で保存する。Shift_JIS / CP932 で保存しない。日本語や絵文字を含むファイルを編集する場合は、文字化け（例: `縺`, `繧`, `繝`, `謨`, `笆`, `�`）が混入していないか確認する。<!-- mojibake-ok: this line intentionally documents common mojibake markers. -->
- **文字化け検知**: 手動確認には `npm run check:mojibake` を使用する。意図的に旧データ互換の文字化け値を残す場合のみ、その行に `mojibake-ok` を明記する。文字化けを見つけた場合は推測で置換せず、git履歴、元CSV、元資料から復元する。

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
