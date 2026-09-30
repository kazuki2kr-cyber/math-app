export type WrittenFeedbackNarrative = {
  feedback?: string;
  rubricScores?: Array<{ comment?: string }>;
  improvementPoints?: string[];
};

// Obvious replacement glyphs and stray character fragments are not useful feedback.
// Keep stored grading data unchanged; only replace unreadable narrative in the UI.
const UNREADABLE_GLYPH_PATTERN = /[\uFFFD\u25A1\u2612\u2500-\u257F\u2E80-\u2FDF\u3400-\u4DBF\uF900-\uFAFF\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;

export function hasUnreadableWrittenFeedback(grading: WrittenFeedbackNarrative): boolean {
  const narrative = [
    grading.feedback || '',
    ...(grading.rubricScores || []).map((item) => item.comment || ''),
    ...(grading.improvementPoints || []),
  ].join('\n');
  return UNREADABLE_GLYPH_PATTERN.test(narrative);
}

export const unreadableRubricComment = '講評に読めない文字が含まれていたため、文章を表示していません。観点別得点と模範解答を確認してください。';
export const unreadableOverallFeedback = '採点は完了しましたが、講評に読めない文字が含まれていたため、文章を表示していません。観点別得点と模範解答を確認してください。';
