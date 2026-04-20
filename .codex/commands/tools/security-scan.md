# /tools:security-scan — Codex Reference

Codex ではこの文書を、既存の Claude 用 `/tools:security-scan` と同等の参照指示として扱います。

- 原本: [`.claude/commands/tools/security-scan.md`](/C:/Users/ichikawa/Desktop/math.app/.claude/commands/tools/security-scan.md)
- 共通ルール: [`.agents/GUIDELINES.md`](/C:/Users/ichikawa/Desktop/math.app/.agents/GUIDELINES.md)
- 関連スキル: [`.agents/skills/security-audit/SKILL.md`](/C:/Users/ichikawa/Desktop/math.app/.agents/skills/security-audit/SKILL.md)

実行時は原本の観点に従い、math.app では特に以下を優先してください。

1. Firestore ルールと Cloud Functions の信頼境界
2. 認可・直接書き込み禁止の担保
3. Firebase 設定や秘密情報の露出確認
4. 変更時の再現手順と具体的な修正提案
