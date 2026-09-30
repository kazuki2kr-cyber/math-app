import {
  hasUnreadableWrittenFeedback,
  unreadableOverallFeedback,
  unreadableRubricComment,
} from '@/lib/writtenFeedbackPresentation';

describe('written feedback presentation', () => {
  test('flags replacement glyphs in one rubric comment so all narrative can be withheld', () => {
    expect(hasUnreadableWrittenFeedback({
      feedback: '文章に不自然な箇所があります。',
      rubricScores: [{ comment: '∠BAC=∠DAE=90☒ から考えています。' }],
    })).toBe(true);
    expect(unreadableRubricComment).toContain('観点別得点');
    expect(unreadableOverallFeedback).toContain('採点は完了');
  });

  test('keeps normal Japanese and LaTeX feedback visible', () => {
    expect(hasUnreadableWrittenFeedback({
      feedback: '仮定から\\(AB=AC\\)を示しています。',
      rubricScores: [{ comment: '角の等しさを正しく説明しています。' }],
      improvementPoints: ['結論を明記しましょう。'],
    })).toBe(false);
  });

  test('flags the stored OCR artifacts from the proof submission', () => {
    expect(hasUnreadableWrittenFeedback({
      feedback: '記載内容は透れており、団体結論への想呼も正しいです。',
      rubricScores: [{ comment: '∠BAC=∠DAE=90\u0080 から考えています。' }],
      improvementPoints: ['┳ABDの記号を確認しましょう。'],
    })).toBe(true);
  });
});
