import { normalizeRubricScores, WrittenRubricCriterion } from '../../../functions/src/writtenRubricScoring';

const criteria: WrittenRubricCriterion[] = [
  { criterionIndex: 1, label: '変数の定義', description: '変数を定義する', maxScore: 15 },
  { criterionIndex: 2, label: '立式', description: '式を立てる', maxScore: 20 },
  { criterionIndex: 3, label: '結論', description: '結論を書く', maxScore: 65 },
];

describe('normalizeRubricScores', () => {
  test('文字列で返された点数を0点にせず数値化する', () => {
    const result = normalizeRubricScores([
      { score: '15点', comment: '正しいです。' },
      { score: '20/20', comment: '正しいです。' },
      { score: '65', comment: '正しいです。' },
    ], criteria, 100);

    expect(result.map((item) => item.score)).toEqual([15, 20, 65]);
  });

  test('AIが別名フィールドを返した場合も点数を読み取る', () => {
    const result = normalizeRubricScores([
      { awardedScore: 10 },
      { earnedScore: 15 },
      { points: 35 },
    ], criteria, 60);

    expect(result.map((item) => item.score)).toEqual([10, 15, 35]);
  });

  test('観点合計が総合点と矛盾する場合は上限内で総合点に整合させる', () => {
    const result = normalizeRubricScores([
      { score: 0, comment: '正しいです。' },
      { score: 0, comment: '正しいです。' },
      { score: 0, comment: '正しいです。' },
    ], criteria, 100);

    expect(result.map((item) => item.score)).toEqual([15, 20, 65]);
    expect(result.reduce((sum, item) => sum + item.score, 0)).toBe(100);
  });

  test('criterionIndexを使って順序のずれた応答を正しい観点へ対応付ける', () => {
    const result = normalizeRubricScores([
      { criterionIndex: 3, score: 30, comment: '結論' },
      { criterionIndex: 1, score: 10, comment: '定義' },
      { criterionIndex: 2, score: 20, comment: '立式' },
    ], criteria, 60);

    expect(result.map((item) => item.score)).toEqual([10, 20, 30]);
    expect(result.map((item) => item.comment)).toEqual(['定義', '立式', '結論']);
  });
});
