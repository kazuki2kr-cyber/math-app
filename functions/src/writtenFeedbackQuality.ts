import type { WrittenRubricScore } from "./writtenRubricScoring";

const UNREADABLE_GLYPH_PATTERN = /[\uFFFD\u25A1\u2612\u2500-\u257F\u2E80-\u2FDF\u3400-\u4DBF\uF900-\uFAFF\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;

export function sanitizeWrittenFeedback(params: {
  feedback: string;
  rubricScores: WrittenRubricScore[];
  improvementPoints: string[];
}): typeof params & { sanitized: boolean } {
  const narrative = [
    params.feedback,
    ...params.rubricScores.map((item) => item.comment),
    ...params.improvementPoints,
  ].join("\n");
  if (!UNREADABLE_GLYPH_PATTERN.test(narrative)) {
    return { ...params, sanitized: false };
  }

  return {
    feedback: "採点は完了しました。講評文に読めない文字が含まれたため、観点別得点と模範解答を確認してください。",
    rubricScores: params.rubricScores.map((item) => ({
      ...item,
      comment: `この観点は${item.maxScore}点中${item.score}点です。採点基準と模範解答を確認してください。`,
    })),
    improvementPoints: [],
    sanitized: true,
  };
}
