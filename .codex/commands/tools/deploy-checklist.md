# /tools:deploy-checklist — Codex Reference

Codex ではこの文書を、既存の Claude 用 `/tools:deploy-checklist` と同等の参照指示として扱います。

- 原本: [`.claude/commands/tools/deploy-checklist.md`](/C:/Users/ichikawa/Desktop/math.app/.claude/commands/tools/deploy-checklist.md)
- 共通ルール: [`.agents/GUIDELINES.md`](/C:/Users/ichikawa/Desktop/math.app/.agents/GUIDELINES.md)

デプロイ前は、UI 挙動、XP 保存、ランキング反映、権限境界、セキュリティルール、必要なテスト結果を確認対象に含めてください。

Gemini記述式採点のモデル、エンドポイント、リクエスト形式、JSON Schema、応答解析を変更する場合は、[`docs/written-grading-architecture.md`](/C:/Users/ichikawa/Desktop/math.app/docs/written-grading-architecture.md) を参照してください。`npm run deploy:written-grading` を唯一の入口として内部ゲートを重複実行せず、更新成功後に答案提出から結果表示まで確認してください。
