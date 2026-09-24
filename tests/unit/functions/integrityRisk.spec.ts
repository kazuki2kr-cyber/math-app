import { assessDrillIntegrity } from '../../../functions/src/integrityRisk';

describe('assessDrillIntegrity', () => {
  test('通常速度の演習は記録対象にしない', () => {
    const result = assessDrillIntegrity({
      timeSec: 120,
      answeredCount: 10,
      correctCount: 8,
      rapidSubmissionSec: null,
    });

    expect(result.flagged).toBe(false);
    expect(result.riskScore).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  test('極端に速い演習は中リスクとして記録する', () => {
    const result = assessDrillIntegrity({
      timeSec: 25,
      answeredCount: 10,
      correctCount: 7,
      rapidSubmissionSec: null,
    });

    expect(result.flagged).toBe(true);
    expect(result.riskScore).toBe(60);
    expect(result.severity).toBe('medium');
    expect(result.signals.map((signal) => signal.code)).toContain('very_fast_answers');
  });

  test('5秒/問以下でも全問正解でなければ速度だけで記録しない', () => {
    const result = assessDrillIntegrity({
      timeSec: 45,
      answeredCount: 10,
      correctCount: 9,
      rapidSubmissionSec: null,
    });

    expect(result.flagged).toBe(false);
  });

  test('5秒/問以下の全問正解は複合的な速度・正確性の兆候として記録する', () => {
    const result = assessDrillIntegrity({
      timeSec: 45,
      answeredCount: 10,
      correctCount: 10,
      rapidSubmissionSec: null,
    });

    expect(result.flagged).toBe(true);
    expect(result.riskScore).toBe(40);
    expect(result.severity).toBe('low');
  });

  test('短時間の全問正解と連続提出が重なる場合は高リスクにする', () => {
    const result = assessDrillIntegrity({
      timeSec: 25,
      answeredCount: 10,
      correctCount: 10,
      rapidSubmissionSec: 12,
    });

    expect(result.flagged).toBe(true);
    expect(result.riskScore).toBe(100);
    expect(result.severity).toBe('high');
    expect(result.signals.map((signal) => signal.code)).toEqual([
      'very_fast_answers',
      'fast_perfect_run',
      'rapid_repeat_submission',
    ]);
  });
});
