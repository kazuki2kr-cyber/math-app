# /tools:math-csv-check — Codex Reference

Codex ではこの文書を、既存の Claude 用 `/tools:math-csv-check` と同等の参照指示として扱います。

- 原本: [`.claude/commands/tools/math-csv-check.md`](/C:/Users/ichikawa/Desktop/math.app/.claude/commands/tools/math-csv-check.md)
- 共通ルール: [`.agents/GUIDELINES.md`](/C:/Users/ichikawa/Desktop/math.app/.agents/GUIDELINES.md)
- 関連スキル: [`.agents/skills/math-csv-check/SKILL.md`](/C:/Users/ichikawa/Desktop/math.app/.agents/skills/math-csv-check/SKILL.md)

`*.csv` を扱う場合は、この参照文書と関連スキルを先に確認し、数学的整合性・LaTeX 表記・`answer_index`・選択肢重複を必ず点検してください。

## 記述式イベントCSVも対象

`/tools:math-csv-check` 相当の作業では、従来の4択CSVに加えて、`question_type=written` の記述式イベントCSVも確認します。

記述式では以下を重点確認してください。

- 同じ `unit_id` に問題が1問だけであること。
- `options` が `[]`、`answer_index` が `1` であること。
- `model_answer` がGemini採点用の模範解答として十分であること。
- `grading_rubric` がJSON配列で、合計100点相当の採点観点になっていること。
- `grading_rubric` は原則「過程・記述60点、最終答・結論40点」。答えが誤りなら最大60点、答えだけ正しく過程がないなら最大40点になる設計であること。
- 答案画像の文字起こしは採点API側の `transcription` で扱うため、`model_answer` や `grading_rubric` にOCR・文字起こし・画像品質の共通指示を混ぜないこと。
- 計算型、文章題・立式型、証明型、図形・関数説明型のいずれに該当するかを判断し、問題タイプに応じた過程60点の内訳になっていること。
- `explanation` は元資料の逐語コピーではなく、学習者向けに書き換えられていること。
- `written_attempt_limit` は原則1、`event_status` と開催期間が意図通りであること。

検証コマンド:

```bash
python .agents/skills/pdf-to-math-csv/scripts/validate_csv.py <対象CSVパス>
```
