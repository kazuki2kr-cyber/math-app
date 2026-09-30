import { sanitizeWrittenFeedback } from '../../../functions/src/writtenFeedbackQuality';

const rubricScore = {
  criterionIndex: 1,
  label: '仮定から等しい辺を示す',
  description: '仮定を使う',
  score: 15,
  maxScore: 15,
  comment: '正しく示しています。',
};

describe('sanitizeWrittenFeedback', () => {
  test('replaces malformed AI prose while preserving rubric scores', () => {
    const result = sanitizeWrittenFeedback({
      feedback: '記載内容は透れており、団体結論への想呼も正しいです。',
      rubricScores: [{ ...rubricScore, comment: '90\u0080 から ┳ABD を考えています。' }],
      improvementPoints: ['丁寧に書きましょう。'],
    });

    expect(result.sanitized).toBe(true);
    expect(result.rubricScores[0].score).toBe(15);
    expect(result.rubricScores[0].maxScore).toBe(15);
    expect(result.rubricScores[0].comment).toContain('15点中15点');
    expect(result.feedback).not.toContain('透れており');
    expect(result.improvementPoints).toEqual([]);
  });

  test('leaves readable feedback unchanged', () => {
    const input = {
      feedback: '角の等しさを説明できています。',
      rubricScores: [rubricScore],
      improvementPoints: ['結論を明記しましょう。'],
    };
    expect(sanitizeWrittenFeedback(input)).toEqual({ ...input, sanitized: false });
  });
});
