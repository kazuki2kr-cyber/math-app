import {
  buildLearningProgressReport,
  getLearningProgressReadiness,
  getLearningUnitStat,
} from '@/lib/learningProgress';

const units = [
  { id: 'unit-a', title: '単元 A', category: '計算' },
  { id: 'unit-b', title: '単元 B', category: '計算' },
  { id: 'unit.c', title: '単元 C', category: '図形' },
  { id: 'written', title: '記述式', category: '図形', drillType: 'written' as const },
];

describe('learning progress report', () => {
  test('calculates weighted accuracy instead of averaging percentages', () => {
    const report = buildLearningProgressReport(units, {
      unitStats: {
        'unit-a': {
          drillCount: 3,
          reviewV1: { attemptCount: 3, answeredCount: 10, correctCount: 10, studyTimeSec: 100 },
          wrongQuestionIds: [],
          updatedAt: '2026-08-20T00:00:00.000Z',
        },
        'unit-b': {
          drillCount: 3,
          reviewV1: { attemptCount: 3, answeredCount: 30, correctCount: 15, studyTimeSec: 300 },
          wrongQuestionIds: ['q1'],
          updatedAt: '2026-08-20T00:00:00.000Z',
        },
      },
    }, new Date('2026-08-24T00:00:00.000Z'));

    expect(report.overall.accuracy).toBe(62.5);
    expect(report.categories.find((category) => category.category === '計算')?.accuracy).toBe(62.5);
    expect(report.overall.studyTimeSec).toBe(400);
    expect(report.units).toHaveLength(3);
  });

  test('marks a well-supported accurate unit as mastered', () => {
    const report = buildLearningProgressReport([units[0]], {
      unitStats: {
        'unit-a': {
          drillCount: 3,
          reviewV1: { attemptCount: 3, answeredCount: 20, correctCount: 18, studyTimeSec: 100 },
          wrongQuestionIds: [],
          updatedAt: '2026-08-20T00:00:00.000Z',
        },
      },
    }, new Date('2026-08-24T00:00:00.000Z'));

    expect(report.units[0].status).toBe('mastered');
    expect(report.recommendations).toHaveLength(0);
  });

  test('prioritizes low accuracy and recommends wrong-answer mode', () => {
    const report = buildLearningProgressReport([units[0], units[1]], {
      unitStats: {
        'unit-a': {
          drillCount: 2,
          reviewV1: { attemptCount: 2, answeredCount: 20, correctCount: 8, studyTimeSec: 100 },
          wrongQuestionIds: ['q1', 'q2'],
        },
      },
    });

    expect(report.recommendations[0].id).toBe('unit-a');
    expect(report.recommendations[0].status).toBe('review');
    expect(report.recommendations[0].recommendedMode).toBe('wrong');
  });

  test('supports legacy dot-notated unit IDs', () => {
    expect(getLearningUnitStat({ unit: { c: { drillCount: 4 } } }, 'unit.c').drillCount).toBe(4);
  });

  test('fills all 28 daily points with zeroes for missing days', () => {
    const report = buildLearningProgressReport([], {
      learningDailyV1: {
        '2026-08-24': { attempts: 2, answered: 20, correct: 15, studyTimeSec: 120 },
      },
    }, new Date('2026-08-24T03:00:00.000Z'));

    expect(report.daily).toHaveLength(28);
    expect(report.daily.at(-1)).toMatchObject({ date: '2026-08-24', attempts: 2, accuracy: 75 });
  });

  test('keeps the report hidden until both evidence thresholds are met', () => {
    const attemptsOnly = buildLearningProgressReport([units[0]], {
      unitStats: {
        'unit-a': { reviewV1: { attemptCount: 3, answeredCount: 10, correctCount: 8 } },
      },
    });
    expect(getLearningProgressReadiness(attemptsOnly)).toMatchObject({
      ready: false,
      remainingAttempts: 0,
      remainingAnswers: 10,
    });

    const ready = buildLearningProgressReport([units[0]], {
      unitStats: {
        'unit-a': { reviewV1: { attemptCount: 3, answeredCount: 20, correctCount: 16 } },
      },
    });
    expect(getLearningProgressReadiness(ready).ready).toBe(true);
  });
});
