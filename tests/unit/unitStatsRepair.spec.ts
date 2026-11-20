const { FieldPath, FieldValue } = require('firebase-admin/firestore');
const {
  extractNestedAsLiteralKeys,
  mergeUnitData,
  buildLiteralDottedFieldDeleteUpdateArgs,
  sanitizeRankingName,
} = require('../../scripts/lib/unitStatsRepair');

describe('unitStatsRepair helpers', () => {
  test('extractNestedAsLiteralKeys preserves non-dotted unit with maxScore === 0 without flattening its properties', () => {
    const input = {
      kanji_unit_1: {
        maxScore: 0,
        drillCount: 2,
        bestTime: 45,
        wrongQuestionIds: ['q1', 'q2'],
      },
      '1': {
        '正負の数の加減': {
          maxScore: 80,
          drillCount: 3,
          bestTime: 30,
          wrongQuestionIds: [],
        },
      },
      '2.文字式の計算': {
        maxScore: 100,
        drillCount: 1,
        bestTime: 25,
        wrongQuestionIds: [],
      },
    };

    const actual = extractNestedAsLiteralKeys(input);

    expect(actual).toEqual({
      kanji_unit_1: {
        maxScore: 0,
        drillCount: 2,
        bestTime: 45,
        wrongQuestionIds: ['q1', 'q2'],
      },
      '1.正負の数の加減': {
        maxScore: 80,
        drillCount: 3,
        bestTime: 30,
        wrongQuestionIds: [],
      },
      '2.文字式の計算': {
        maxScore: 100,
        drillCount: 1,
        bestTime: 25,
        wrongQuestionIds: [],
      },
    });
    expect(actual['kanji_unit_1.maxScore']).toBeUndefined();
    expect(actual['kanji_unit_1.drillCount']).toBeUndefined();
  });

  test('buildLiteralDottedFieldDeleteUpdateArgs uses FieldPath for literal dotted keys so legitimate unitStats map is untouched', () => {
    const docData = {
      uid: 'u1',
      displayName: 'Taro',
      unitStats: {
        '1.正負の数の加減': { maxScore: 90, drillCount: 2 },
      },
      'unitStats.1.正負の数の加減': { maxScore: 40, drillCount: 1 },
      'lastAttemptTimes.1.正負の数の加減': '2026-10-01T00:00:00.000Z',
    };

    const { fieldsToDelete, updateArgs } = buildLiteralDottedFieldDeleteUpdateArgs(
      docData,
      FieldPath,
      FieldValue,
      { totalScore: 90 }
    );

    expect(fieldsToDelete).toEqual([
      'unitStats.1.正負の数の加減',
      'lastAttemptTimes.1.正負の数の加減',
    ]);
    // 2 deleted fields + 1 extraField => 3 pairs = 6 variadic arguments
    expect(updateArgs).toHaveLength(6);
    expect(updateArgs[0]).toEqual(new FieldPath('unitStats.1.正負の数の加減'));
    expect(updateArgs[1]).toEqual(FieldValue.delete());
    expect(updateArgs[2]).toEqual(new FieldPath('lastAttemptTimes.1.正負の数の加減'));
    expect(updateArgs[3]).toEqual(FieldValue.delete());
    expect(updateArgs[4]).toEqual(new FieldPath('totalScore'));
    expect(updateArgs[5]).toBe(90);
  });

  test('mergeUnitData prefers higher drillCount and sanitizeRankingName masks emails', () => {
    expect(mergeUnitData({ maxScore: 50, drillCount: 1 }, { maxScore: 80, drillCount: 3 })).toEqual({
      maxScore: 80,
      drillCount: 3,
    });
    expect(sanitizeRankingName('student@shibaurafzk.com')).toBe('名無し');
    expect(sanitizeRankingName('山田 太郎')).toBe('山田 太郎');
  });
});
