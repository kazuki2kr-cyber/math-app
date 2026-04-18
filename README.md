# math.app — 中学生向け数学学習 Web アプリ

## 概要
数学演算ドリル、ランキング、XP/レベルシステムを搭載した中学生向け学習システムです。

## 技術構成
- **Frontend**: Next.js, React, Tailwind CSS v4, KaTeX
- **Backend**: Firebase (Cloud Functions, Firestore, Auth)

## 開発を始める方・AIエージェントへ
開発の詳細なガイドライン、コーディング規約、セキュルールについては、以下のドキュメントを必ず参照してください。

👉 **[GUIDELINES.md](file:///.agents/GUIDELINES.md)** (AIエージェント共通ルール)

## クイックスタート

```bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npm run dev

# テストの実行
npm test
```

## デプロイ
- フロントエンド: GitHub `main` ブランチへの push で Vercel に自動デプロイ。
- バックエンド: `firebase deploy` で手動デプロイ。
