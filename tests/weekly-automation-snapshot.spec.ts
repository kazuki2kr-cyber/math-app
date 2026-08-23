/* eslint-disable @typescript-eslint/no-require-imports -- CommonJSの運用スクリプトを直接検証する。 */
const {
  aggregateTrendDays,
  buildSnapshot,
  buildWeeklyWindows,
  normalizePageGroup,
  sanitizeFreeText,
} = require('../scripts/lib/weekly-automation-snapshot');

describe('weekly automation snapshot', () => {
  test('日本時間の実行日を含む直近7日と前7日を作る', () => {
    expect(buildWeeklyWindows('2026-08-07')).toEqual({
      asOfDate: '2026-08-07',
      timezone: 'Asia/Tokyo',
      current: { startDate: '2026-08-01', endDate: '2026-08-07', endExclusive: '2026-08-08' },
      previous: { startDate: '2026-07-25', endDate: '2026-07-31', endExclusive: '2026-08-01' },
    });
  });

  test('回答数があれば正答率を正答数ベースで集計する', () => {
    const result = aggregateTrendDays([
      { date: '2026-08-01', totalAttempts: 2, totalAnswered: 20, totalCorrect: 10, avgAccuracy: 50, studyTimeSec: 120, uniqueUsers: 2 },
      { date: '2026-08-02', totalAttempts: 1, totalAnswered: 10, totalCorrect: 9, avgAccuracy: 90, studyTimeSec: 60, uniqueUsers: 1 },
    ], { startDate: '2026-08-01', endDate: '2026-08-07', endExclusive: '2026-08-08' });
    expect(result).toMatchObject({
      totalAttempts: 3,
      totalAnswered: 30,
      totalCorrect: 19,
      avgAccuracy: 63.33,
      totalStudyTimeSec: 180,
      activeLearnerDays: 3,
      uniqueLearners: null,
    });
  });

  test('匿名化済み週次集計があれば正確なユニーク学習者・習熟・次問正解を使う', () => {
    const result = aggregateTrendDays([], {
      startDate: '2026-08-01', endDate: '2026-08-07', endExclusive: '2026-08-08',
    }, {
      startDate: '2026-08-01', endDate: '2026-08-07', calendarDaysWithData: 6,
      totalAttempts: 12, totalAnswered: 60, totalCorrect: 42, avgAccuracy: 70,
      totalStudyTimeSec: 900, activeLearnerDays: 15, uniqueLearners: 8,
      latestAnswerMasteryRate: 75, masteredLearnerQuestions: 30, eligibleLearnerQuestions: 40,
      nextItemCorrectnessRateAfterError: 60, correctTransitionsAfterError: 6,
      eligibleTransitionsAfterError: 10,
    });
    expect(result).toMatchObject({
      totalAttempts: 12,
      totalAnswered: 60,
      uniqueLearners: 8,
      mastery: { latestAnswerMasteryRate: 75, masteredLearnerQuestions: 30 },
      nextItemCorrectness: { rateAfterError: 60, correctTransitionsAfterError: 6 },
    });
  });

  test('カテゴリでも日次の少人数非表示行ではなく匿名化済み週次集計を優先する', () => {
    const snapshot = buildSnapshot({
      asOfDate: '2026-08-07',
      projectId: 'math-app-26c77',
      overview: { privacy: { publishable: true }, totals: {} },
      trends: {
        days: [],
        weeklyPeriods: [{
          startDate: '2026-08-01', endDate: '2026-08-07', totalAttempts: 12,
          totalAnswered: 60, totalCorrect: 42, avgAccuracy: 70, totalStudyTimeSec: 900,
          activeLearnerDays: 15, uniqueLearners: 8,
        }],
      },
      categories: [{
        category: '一次方程式',
        totals: {},
        trends: {
          days: [{
            date: '2026-08-01', totalAttempts: 2, totalAnswered: 10, totalCorrect: 5,
            avgAccuracy: 50, studyTimeSec: 100, uniqueUsers: 5,
          }],
          weeklyPeriods: [{
            startDate: '2026-08-01', endDate: '2026-08-07', totalAttempts: 9,
            totalAnswered: 45, totalCorrect: 27, avgAccuracy: 60, totalStudyTimeSec: 600,
            activeLearnerDays: 11, uniqueLearners: 6,
          }],
        },
      }],
      generalFeedback: [],
      writtenFeedback: [],
    });

    expect(snapshot.analytics.categories[0].currentPeriod).toMatchObject({
      totalAttempts: 9,
      totalAnswered: 45,
      uniqueLearners: 6,
      activeLearnerDays: 11,
    });
    expect(snapshot.analytics.categoryCoverage.currentPeriod).toMatchObject({
      reportedAttempts: 9,
      unavailableByCategoryAttempts: 3,
      reportedAttemptShare: 75,
    });
    expect(snapshot.analytics.categories[0].currentPeriod.mastery).toMatchObject({
      latestAnswerMasteryRate: null,
      unavailableReason: 'この集計では習熟指標を利用できないため',
    });
  });

  test('自由記述から既知識別子・メール・電話番号・URL・長いIDを除去する', () => {
    const result = sanitizeFreeText(
      '山田太郎です。taro@example.com、090-1234-5678、https://example.com/a、abcdefghijklmnopqrstuvwx',
      ['山田太郎'],
    );
    expect(result).not.toContain('山田太郎');
    expect(result).not.toContain('taro@example.com');
    expect(result).not.toContain('090-1234-5678');
    expect(result).not.toContain('https://');
    expect(result).not.toContain('abcdefghijklmnopqrstuvwx');
    expect(result.match(/\[非表示\]/g)?.length).toBeGreaterThanOrEqual(5);
  });

  test('ページパスは詳細IDを含まないグループへ変換する', () => {
    expect(normalizePageGroup('/drill/unit-secret?uid=abc')).toBe('/drill');
    expect(normalizePageGroup('/unknown/student/abc')).toBe('/other');
  });

  test('出力に直接識別子・端末情報・個人成績を含めない', () => {
    const snapshot = buildSnapshot({
      asOfDate: '2026-08-07',
      projectId: 'math-app-26c77',
      overview: { privacy: { publishable: true }, totals: {} },
      trends: { days: [] },
      categories: [],
      generalFeedback: [{
        uid: 'secret-uid', userName: '山田太郎', userEmail: 'taro@example.com',
        userAgent: 'secret-agent', pagePath: '/drill/secret-unit', message: '山田太郎です。改善してほしい',
        createdAt: '2026-08-02T00:00:00Z', status: 'new',
      }],
      writtenFeedback: [{
        uid: 'secret-uid', userName: '山田太郎', userEmail: 'taro@example.com', attemptId: 'secret-attempt',
        questionId: 'secret-question', questionText: 'secret-question-text', score: 10,
        unitTitle: '一次方程式', message: '分かりやすい', createdAt: '2026-08-03T00:00:00Z', status: 'new',
        rating: 'helpful', strictness: 'appropriate', usefulness: 'very_useful', clarity: 'clear',
      }],
    });
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of [
      'secret-uid', '山田太郎', 'taro@example.com', 'secret-agent', 'secret-attempt',
      'secret-question', 'secret-question-text', '"score"', '"userName"', '"userEmail"', '"uid"', '"userAgent"',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
