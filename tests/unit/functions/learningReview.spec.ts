import {
  LEARNING_DAILY_RETENTION_DAYS,
  getJstDateKey,
  updateLearningReviewStats,
} from '../../../functions/src/learningReview';

describe('learning review aggregation', () => {
  test('uses the Asia/Tokyo calendar date', () => {
    expect(getJstDateKey(new Date('2026-08-24T15:30:00.000Z'))).toBe('2026-08-25');
  });

  test('accumulates per-unit and daily counters', () => {
    const result = updateLearningReviewStats({
      existingReview: {
        version: 1,
        startedAt: '2026-08-01T00:00:00.000Z',
        attemptCount: 2,
        answeredCount: 20,
        correctCount: 15,
        studyTimeSec: 300,
      },
      existingDaily: {
        '2026-08-24': { attempts: 1, answered: 10, correct: 8, studyTimeSec: 120 },
      },
      correctCount: 7,
      answeredCount: 10,
      studyTimeSec: 90,
      now: new Date('2026-08-24T05:00:00.000Z'),
    });

    expect(result.reviewV1).toEqual({
      version: 1,
      startedAt: '2026-08-01T00:00:00.000Z',
      attemptCount: 3,
      answeredCount: 30,
      correctCount: 22,
      studyTimeSec: 390,
    });
    expect(result.learningDailyV1['2026-08-24']).toEqual({
      attempts: 2,
      answered: 20,
      correct: 15,
      studyTimeSec: 210,
    });
  });

  test('keeps only the latest bounded date window', () => {
    const existingDaily = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => {
        const date = new Date('2026-08-24T03:00:00.000Z');
        date.setUTCDate(date.getUTCDate() - index);
        return [getJstDateKey(date), { attempts: 1, answered: 1, correct: 1, studyTimeSec: 1 }];
      }),
    );

    const result = updateLearningReviewStats({
      existingReview: null,
      existingDaily,
      correctCount: 1,
      answeredCount: 1,
      studyTimeSec: 1,
      now: new Date('2026-08-24T03:00:00.000Z'),
    });

    expect(Object.keys(result.learningDailyV1)).toHaveLength(LEARNING_DAILY_RETENTION_DAYS);
    expect(result.learningDailyV1['2026-08-24'].attempts).toBe(2);
    expect(result.learningDailyV1['2026-07-28']).toBeDefined();
    expect(result.learningDailyV1['2026-07-27']).toBeUndefined();
  });

  test('starts safely when legacy fields are missing or malformed', () => {
    const result = updateLearningReviewStats({
      existingReview: { attemptCount: 'invalid', answeredCount: -5 },
      existingDaily: null,
      correctCount: 3,
      answeredCount: 5,
      studyTimeSec: 42,
      now: new Date('2026-08-24T03:00:00.000Z'),
    });

    expect(result.reviewV1.attemptCount).toBe(1);
    expect(result.reviewV1.answeredCount).toBe(5);
    expect(result.reviewV1.correctCount).toBe(3);
  });
});
