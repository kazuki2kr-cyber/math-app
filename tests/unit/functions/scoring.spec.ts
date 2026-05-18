/**
 * Cloud Function (functions/src/index.ts) に埋め込まれたスコア・XP 計算ロジックのユニットテスト。
 *
 * Cloud Function 本体は Firebase Admin SDK に依存するため直接インポートせず、
 * 純粋なロジック部分を関数として再現してテストする。
 * ロジックを変更した際はここも更新すること。
 */

// ─────────────────────────────────────────────────────────
// functions/src/index.ts から抜き出した純粋ロジック
// ─────────────────────────────────────────────────────────

const STANDARD_XP_QUESTION_COUNT = 10;

type DrillMode = 'standard' | 'wrong' | 'all';

/** スコア計算: 通常・間違い直しは10点刻み、全問演習は割合ベース */
function calculateScore(correctCount: number, totalAnswered: number, mode: DrillMode = 'standard'): number {
  if (mode === 'all') {
    return totalAnswered > 0 ? Math.min(100, Math.round((correctCount / totalAnswered) * 100)) : 0;
  }

  return Math.min(100, correctCount * 10);
}

/** XP 逓減レート: drillCount（0始まり）に基づく乗算係数 */
function getXpRateMultiplier(drillCount: number): number {
  const attemptNumber = drillCount + 1; // 1始まり
  if (attemptNumber <= 3) return 1.0;   // 1〜3回目: 100%
  if (attemptNumber <= 5) return 0.7;   // 4〜5回目:  70%
  if (attemptNumber <= 10) return 0.3;  // 6〜10回目: 30%
  return 0;                             // 11回目以降:  0%
}

/** 正解率に基づくスコア倍率 */
function getCorrectRatioMultiplier(correctCount: number, totalAnswered: number): number {
  const correctRatio = totalAnswered > 0 ? correctCount / totalAnswered : 0;
  if (correctRatio === 1) return 1.5;
  if (correctRatio >= 0.7) return 1.0;
  if (correctRatio >= 0.5) return 0.5;
  return 0;
}

/** コンボ込み XP 計算。正解順序 (true/false の配列) を受け取る */
function calculateXpComponents(answerOrder: boolean[]): {
  baseTotal: number;
  comboTotal: number;
  multiplier: number;
} {
  let baseTotal = 0;
  let comboTotal = 0;
  let currentCombo = 0;

  for (const isCorrect of answerOrder) {
    if (isCorrect) {
      currentCombo++;
      baseTotal += 10;
      comboTotal += currentCombo;
    } else {
      currentCombo = 0;
    }
  }

  const totalAnswered = answerOrder.length;
  const correctCount = answerOrder.filter(Boolean).length;
  const multiplier = getCorrectRatioMultiplier(correctCount, totalAnswered);

  const questionCountFactor = totalAnswered > 0
    ? Math.min(1, STANDARD_XP_QUESTION_COUNT / totalAnswered)
    : 0;
  return {
    baseTotal: Math.round(baseTotal * questionCountFactor),
    comboTotal: Math.round(comboTotal * questionCountFactor * questionCountFactor),
    multiplier,
  };
}

/** 最終 XP: floor((base + combo) × 倍率 × 逓減レート) */
function calculateFinalXp(answerOrder: boolean[], drillCount: number): number {
  const { baseTotal, comboTotal, multiplier } = calculateXpComponents(answerOrder);
  const xpRateMultiplier = getXpRateMultiplier(drillCount);
  return Math.floor((baseTotal + comboTotal) * multiplier * xpRateMultiplier);
}

/** 不正解 ID リストの更新ロジック */
function updateWrongAnswers(
  existing: string[],
  newlyCorrect: string[],
  newlyWrong: string[]
): string[] {
  let current = [...existing];
  current = current.filter((id) => !newlyCorrect.includes(id));
  newlyWrong.forEach((id) => {
    if (!current.includes(id)) current.push(id);
  });
  return current;
}

// ─────────────────────────────────────────────────────────
// テスト
// ─────────────────────────────────────────────────────────

describe('スコア計算 (calculateScore)', () => {
  test('通常演習: 1問だけ正解した場合は10点', () => expect(calculateScore(1, 1, 'standard')).toBe(10));
  test('通常演習: 5問正解した場合は50点', () => expect(calculateScore(5, 5, 'standard')).toBe(50));
  test('通常演習: 10問正解した場合は100点', () => expect(calculateScore(10, 10, 'standard')).toBe(100));
  test('通常演習: 11問以上正解しても100点で上限', () => expect(calculateScore(15, 15, 'standard')).toBe(100));
  test('間違い直し: 1問だけ正解した場合は10点', () => expect(calculateScore(1, 1, 'wrong')).toBe(10));
  test('間違い直し: 3問正解した場合は30点', () => expect(calculateScore(3, 3, 'wrong')).toBe(30));
  test('全問演習: 1問だけの単元を全問正解した場合は100点', () => expect(calculateScore(1, 1, 'all')).toBe(100));
  test('全問演習: 15/30 正解 → 50点', () => expect(calculateScore(15, 30, 'all')).toBe(50));
  test('全問演習: 29/30 正解は四捨五入される', () => expect(calculateScore(29, 30, 'all')).toBe(97));
  test('全問演習: 50問全問正解でも100点で上限', () => expect(calculateScore(50, 50, 'all')).toBe(100));
  test('totalAnswered=0 の場合は 0点', () => expect(calculateScore(0, 0, 'all')).toBe(0));
});

describe('XP 逓減レート (getXpRateMultiplier)', () => {
  test.each([
    [0, 1.0, '1回目'],
    [1, 1.0, '2回目'],
    [2, 1.0, '3回目'],
    [3, 0.7, '4回目'],
    [4, 0.7, '5回目'],
    [5, 0.3, '6回目'],
    [6, 0.3, '7回目'],
    [9, 0.3, '10回目'],
    [10, 0,   '11回目'],
    [20, 0,   '21回目'],
    [99, 0,   '100回目'],
  ] as const)('drillCount=%i → %d (%s)', (drillCount, expected, _label) => {
    expect(getXpRateMultiplier(drillCount)).toBe(expected);
  });
});

describe('正解率倍率 (getCorrectRatioMultiplier)', () => {
  test('全問正解 (10/10) → 1.5倍', () => expect(getCorrectRatioMultiplier(10, 10)).toBe(1.5));
  test('7/10 正解 → 1.0倍', () => expect(getCorrectRatioMultiplier(7, 10)).toBe(1.0));
  test('5/10 正解 → 0.5倍', () => expect(getCorrectRatioMultiplier(5, 10)).toBe(0.5));
  test('4/10 正解 → 0倍', () => expect(getCorrectRatioMultiplier(4, 10)).toBe(0));
  test('0/10 正解 → 0倍', () => expect(getCorrectRatioMultiplier(0, 10)).toBe(0));
  test('totalAnswered=0 の場合は 0倍（ゼロ除算防止）', () => expect(getCorrectRatioMultiplier(0, 0)).toBe(0));
  test('1/1 正解 → 1.5倍', () => expect(getCorrectRatioMultiplier(1, 1)).toBe(1.5));
});

describe('XP コンボ計算 (calculateXpComponents)', () => {
  test('全問正解 10問: base=100, combo=55 (1+2+…+10), multiplier=1.5', () => {
    const { baseTotal, comboTotal, multiplier } = calculateXpComponents(Array(10).fill(true));
    expect(baseTotal).toBe(100);
    expect(comboTotal).toBe(55); // 1+2+3+4+5+6+7+8+9+10
    expect(multiplier).toBe(1.5);
  });

  test('全問不正解: base=0, combo=0, multiplier=0', () => {
    const { baseTotal, comboTotal, multiplier } = calculateXpComponents(Array(5).fill(false));
    expect(baseTotal).toBe(0);
    expect(comboTotal).toBe(0);
    expect(multiplier).toBe(0);
  });

  test('不正解でコンボがリセットされる: [T,T,F,T] → combo=1+2+1=4', () => {
    const { comboTotal } = calculateXpComponents([true, true, false, true]);
    expect(comboTotal).toBe(4);
  });

  test('先頭が不正解でもコンボが積み上がる: [F,T,T] → combo=1+2=3', () => {
    const { comboTotal } = calculateXpComponents([false, true, true]);
    expect(comboTotal).toBe(3);
  });

  test('1問だけ正解: base=10, combo=1', () => {
    const { baseTotal, comboTotal } = calculateXpComponents([true]);
    expect(baseTotal).toBe(10);
    expect(comboTotal).toBe(1);
  });

  test('全問正解 30問は10問相当に正規化される', () => {
    const { baseTotal, comboTotal, multiplier } = calculateXpComponents(Array(30).fill(true));
    expect(baseTotal).toBe(100);
    expect(comboTotal).toBe(52);
    expect(multiplier).toBe(1.5);
  });

  test('全問正解 50問でも10問相当の上限内に収まる', () => {
    const { baseTotal, comboTotal, multiplier } = calculateXpComponents(Array(50).fill(true));
    expect(baseTotal).toBe(100);
    expect(comboTotal).toBeLessThanOrEqual(55);
    expect(multiplier).toBe(1.5);
  });
});

describe('最終 XP 計算 (calculateFinalXp)', () => {
  test('全問正解・初回: XP = floor((100+55) * 1.5 * 1.0) = 232', () => {
    const xp = calculateFinalXp(Array(10).fill(true), 0);
    expect(xp).toBe(232);
  });

  test('全問正解・4回目 (drillCount=3): 逓減 0.7 適用', () => {
    const xp = calculateFinalXp(Array(10).fill(true), 3);
    expect(xp).toBe(Math.floor(155 * 1.5 * 0.7));
  });

  test('全問正解・11回目 (drillCount=10): XP=0', () => {
    const xp = calculateFinalXp(Array(10).fill(true), 10);
    expect(xp).toBe(0);
  });

  test('全問不正解・初回: XP=0', () => {
    const xp = calculateFinalXp(Array(10).fill(false), 0);
    expect(xp).toBe(0);
  });

  test('1問正解・初回 (1問構成): XP = floor((10+1) * 1.5 * 1.0) = 16', () => {
    const xp = calculateFinalXp([true], 0);
    expect(xp).toBe(16);
  });

  test('30問全問正解・初回でも10問満点時と同程度に正規化される', () => {
    const xp = calculateFinalXp(Array(30).fill(true), 0);
    expect(xp).toBe(Math.floor((100 + 52) * 1.5));
  });

  test('50問全問正解・初回でも10問満点時のXPを超えない', () => {
    const tenQuestionXp = calculateFinalXp(Array(10).fill(true), 0);
    const fiftyQuestionXp = calculateFinalXp(Array(50).fill(true), 0);
    expect(fiftyQuestionXp).toBeLessThanOrEqual(tenQuestionXp);
  });

  test('100問全問正解・初回でも10問満点時のXPを超えない', () => {
    const tenQuestionXp = calculateFinalXp(Array(10).fill(true), 0);
    const hundredQuestionXp = calculateFinalXp(Array(100).fill(true), 0);
    expect(hundredQuestionXp).toBeLessThanOrEqual(tenQuestionXp);
  });
});

describe('不正解 ID リスト管理 (updateWrongAnswers)', () => {
  test('初回不正解: ID が追加される', () => {
    const result = updateWrongAnswers([], [], ['q1']);
    expect(result).toContain('q1');
  });

  test('正解すると不正解リストから除去される', () => {
    const result = updateWrongAnswers(['q1'], ['q1'], []);
    expect(result).not.toContain('q1');
  });

  test('不正解リストに重複は追加されない', () => {
    const result = updateWrongAnswers(['q1'], [], ['q1']);
    expect(result.filter((id) => id === 'q1')).toHaveLength(1);
  });

  test('複数ラウンドの累積が正しく動作する', () => {
    // Round 1: q1 不正解, q2 正解
    let wrongs = updateWrongAnswers([], ['q2'], ['q1']);
    expect(wrongs).toEqual(['q1']);

    // Round 2 (復習): q1 正解
    wrongs = updateWrongAnswers(wrongs, ['q1'], []);
    expect(wrongs).toHaveLength(0);
  });

  test('既存の不正解 ID を保持しつつ新規 ID を追加する', () => {
    const result = updateWrongAnswers(['q1'], [], ['q2']);
    expect(result).toContain('q1');
    expect(result).toContain('q2');
  });

  test('異なる問題を正解しても関係のない不正解 ID は残る', () => {
    const result = updateWrongAnswers(['q1', 'q2'], ['q2'], []);
    expect(result).toContain('q1');
    expect(result).not.toContain('q2');
  });
});
