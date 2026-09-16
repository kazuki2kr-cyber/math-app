import {
  preserveTotalScoreForWrittenAttempt,
  WRITTEN_INCLUDE_IN_TOTAL_SCORE,
} from '../../../functions/src/writtenRankingPolicy';

describe('written ranking policy', () => {
  test('記述式の得点を合計スコアへ含めない', () => {
    expect(WRITTEN_INCLUDE_IN_TOTAL_SCORE).toBe(false);
  });

  test('記述式でXPを獲得しても既存の合計スコアを維持する', () => {
    expect(preserveTotalScoreForWrittenAttempt(275)).toBe(275);
    expect(preserveTotalScoreForWrittenAttempt(undefined)).toBe(0);
  });
});
