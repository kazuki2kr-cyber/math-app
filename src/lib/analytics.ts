/**
 * 分析計算ユーティリティ
 * admin/page.tsx から独立させた統計計算関数群
 */

// ============================================
// 型定義
// ============================================

export interface QuestionStat {
  qId: string;
  questionText: string;
  total: number;
  correct: number;
  rate: number;
  difficulty: 'very_easy' | 'easy' | 'normal' | 'hard' | 'very_hard';
}

export interface CorrelationPair {
  qIdA: string;
  qIdB: string;
  qTextA: string;
  qTextB: string;
  indexA: number;
  indexB: number;
  phi: number;
  direction: 'positive' | 'negative';
  strength: 'strong' | 'moderate';
}

export interface StudentRank {
  uid: string;
  userName: string;
  value: number; 
  displayValue: string; 
  avgTime?: number; 
  rankValue?: string; 
}

export interface OverviewMetrics {
  totalAttempts: number;
  uniqueUsers: number;
  avgAccuracy: number;
  unitAccuracies: Array<{
    unitId: string;
    unitTitle: string;
    accuracy: number;
    totalAttempts: number;
  }>;
  categoryAccuracies?: Array<{
    category: string;
    accuracy: number;
    totalAttempts: number;
  }>;
  rankings?: {
    topAccuracy: StudentRank[];
    worstAccuracy: StudentRank[];
    topCorrect: StudentRank[];
    worstCorrect: StudentRank[];
  };
}

export interface ActionSuggestion {
  type: 'warning' | 'info' | 'success';
  icon: string;
  title: string;
  description: string;
  targetQId?: string;
  fullText?: string;
}

// ============================================
// 共通ロジック
// ============================================

/**
 * 統計データから特定の質問の数値を安全に抽出するヘルパー (V4 Fix)
 * ネストされたオブジェクトと、フラットなキー ("qId.total") の両方に対応
 */
function getQuestionStatValue(stats: Record<string, any>, qId: string) {
  const qStr = qId?.toString();
  
  // 1. ネストされたオブジェクト形式を確認
  const nested = stats[qStr] || stats[`q_${qStr}`];
  if (nested && typeof nested === 'object') {
    return {
      total: Number(nested.total || 0),
      correct: Number(nested.correct || 0)
    };
  }

  // 2. フラットなキー形式を確認 (e.g. "1.total", "q_1.total")
  const total = stats[`${qStr}.total`] || stats[`q_${qStr}.total`] || 0;
  const correct = stats[`${qStr}.correct`] || stats[`q_${qStr}.correct`] || 0;

  return {
    total: Number(total),
    correct: Number(correct)
  };
}

export function calculatePhi(v1: number[], v2: number[]): number {
  let n11 = 0, n10 = 0, n01 = 0, n00 = 0;
  for (let i = 0; i < v1.length; i++) {
    if (v1[i] === 1 && v2[i] === 1) n11++;
    else if (v1[i] === 1 && v2[i] === 0) n10++;
    else if (v1[i] === 0 && v2[i] === 1) n01++;
    else n00++;
  }
  const num = (n11 * n00) - (n10 * n01);
  const denom = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00));
  return denom === 0 ? 0 : num / denom;
}

/**
 * 相関行列から顕著な相関ペア（|φ| > threshold）を抽出し、
 * 絶対値の降順でソートする
 */
export function extractSignificantCorrelations(
  matrix: number[][],
  questions: Array<{ id: string; question_text: string }>,
  threshold: number = 0.5
): CorrelationPair[] {
  const pairs: CorrelationPair[] = [];
  const n = matrix.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const phi = matrix[i][j];
      if (Math.abs(phi) >= threshold) {
        pairs.push({
          qIdA: questions[i].id,
          qIdB: questions[j].id,
          qTextA: questions[i].question_text,
          qTextB: questions[j].question_text,
          indexA: i,
          indexB: j,
          phi,
          direction: phi > 0 ? 'positive' : 'negative',
          strength: Math.abs(phi) >= 0.7 ? 'strong' : 'moderate',
        });
      }
    }
  }

  pairs.sort((a, b) => Math.abs(b.phi) - Math.abs(a.phi));
  return pairs;
}

export function classifyDifficulty(rate: number): QuestionStat['difficulty'] {
  if (rate >= 90) return 'very_easy';
  if (rate >= 70) return 'easy';
  if (rate >= 40) return 'normal';
  if (rate >= 20) return 'hard';
  return 'very_hard';
}

// ============================================
// 概要メトリクス算出
// ============================================

export function calculateOverviewFromStats(
  units: Array<{ id: string; title: string; questions?: any[] }>,
  allStats: Record<string, any>
): OverviewMetrics {
  let totalAttempts = 0;
  let totalCorrect = 0;
  let totalAnswered = 0;
  const unitAccuracies: OverviewMetrics['unitAccuracies'] = [];

  for (const unit of units) {
    const stats = allStats[unit.id];
    if (!stats) continue;

    let unitTotal = 0;
    let unitCorrect = 0;

    for (const [key, value] of Object.entries(stats)) {
      if (typeof value === 'object' && value !== null) {
        if ('total' in value) unitTotal += Number(value.total) || 0;
        if ('correct' in value) unitCorrect += Number(value.correct) || 0;
      } else if (key.endsWith('.total')) {
        unitTotal += Number(value) || 0;
      } else if (key.endsWith('.correct')) {
        unitCorrect += Number(value) || 0;
      }
    }

    if (unitTotal > 0) {
      unitAccuracies.push({
        unitId: unit.id,
        unitTitle: unit.title.replace(/^単元\s*/, ''),
        accuracy: (unitCorrect / unitTotal) * 100,
        totalAttempts: unitTotal,
      });
      totalAttempts += unitTotal;
      totalCorrect += unitCorrect;
      totalAnswered += unitTotal;
    }
  }

  unitAccuracies.sort((a, b) => b.accuracy - a.accuracy);

  return {
    totalAttempts,
    uniqueUsers: 0,
    avgAccuracy: totalAnswered > 0 ? (totalCorrect / totalAnswered) * 100 : 0,
    unitAccuracies,
  };
}

/**
 * 分野（分野）別の集計データを算出する
 */
export function calculateCategoryAccuracies(
  units: Array<{ id: string; category?: string; questions?: any[] }>,
  allStats: Record<string, any>
): OverviewMetrics['categoryAccuracies'] {
  const catMap: Record<string, { total: number; correct: number }> = {};

  for (const unit of units) {
    const stats = allStats[unit.id];
    if (!stats) continue;

    const catName = unit.category || 'その他';
    if (!catMap[catName]) catMap[catName] = { total: 0, correct: 0 };

    let unitTotal = 0;
    let unitCorrect = 0;

    for (const [key, value] of Object.entries(stats)) {
      if (typeof value === 'object' && value !== null) {
        if ('total' in value) unitTotal += Number(value.total) || 0;
        if ('correct' in value) unitCorrect += Number(value.correct) || 0;
      } else if (key.endsWith('.total')) {
        unitTotal += Number(value) || 0;
      } else if (key.endsWith('.correct')) {
        unitCorrect += Number(value) || 0;
      }
    }

    catMap[catName].total += unitTotal;
    catMap[catName].correct += unitCorrect;
  }

  const results = Object.entries(catMap)
    .filter(([_, data]) => data.total > 0)
    .map(([category, data]) => ({
      category,
      accuracy: (data.correct / data.total) * 100,
      totalAttempts: data.total
    }));

  results.sort((a, b) => b.totalAttempts - a.totalAttempts); // 利用数順
  return results;
}

/**
 * 生徒ランキング算出 (V3)
 */
export function calculateStudentRankings(
  scores: any[],
  units: any[]
): NonNullable<OverviewMetrics['rankings']> {
  if (!scores.length) {
    return {
      topAccuracy: [], worstAccuracy: [],
      topCorrect: [], worstCorrect: []
    };
  }

  const studentMap: Record<string, { 
    uid: string; 
    userName: string; 
    totalAccuracy: number; 
    unitCount: number; 
    totalCorrect: number;
    totalTime: number; 
  }> = {};

  for (const s of scores) {
    if (!s.uid) continue;
    if (!studentMap[s.uid]) {
      studentMap[s.uid] = { 
        uid: s.uid, 
        userName: s.userName || '不明なユーザー', 
        totalAccuracy: 0, 
        unitCount: 0, 
        totalCorrect: 0,
        totalTime: 0
      };
    }
    
    const scoreVal = s.maxScore ?? s.score ?? 0;
    const timeVal = s.bestTime ?? s.time ?? 0;

    studentMap[s.uid].totalAccuracy += scoreVal;
    studentMap[s.uid].unitCount += 1;
    studentMap[s.uid].totalTime += timeVal;

    const solvedCount = s.totalCorrect || 0;
    studentMap[s.uid].totalCorrect += solvedCount;
  }

  const students = Object.values(studentMap)
    .filter(s => s.unitCount > 0)
    .map(s => {
      const avgAcc = s.totalAccuracy / s.unitCount;
      const avgTime = s.totalTime / s.unitCount; 
      return {
        uid: s.uid,
        userName: s.userName,
        accuracy: avgAcc,
        correctCount: s.totalCorrect,
        avgTime: avgTime,
        unitCount: s.unitCount
      };
    });

  if (!students.length) {
     return { topAccuracy: [], worstAccuracy: [], topCorrect: [], worstCorrect: [] };
  }

  // 1. 実力派ランキング (正答率順)
  const sortedByAcc = [...students].sort((a, b) => {
    if (Math.abs(b.accuracy - a.accuracy) > 0.01) return b.accuracy - a.accuracy;
    return a.avgTime - b.avgTime; 
  });

  const topAcc = sortedByAcc.map(s => ({
    uid: s.uid, 
    userName: s.userName, 
    value: s.accuracy, 
    displayValue: `${Math.round(s.accuracy)}%`,
    rankValue: s.avgTime > 0 ? `${Math.round(s.avgTime)}秒/単元` : undefined
  }));

  const worstAcc = [...students].sort((a, b) => {
    if (Math.abs(a.accuracy - b.accuracy) > 0.01) return a.accuracy - b.accuracy;
    return b.avgTime - a.avgTime; 
  }).map(s => ({
    uid: s.uid, 
    userName: s.userName, 
    value: s.accuracy, 
    displayValue: `${Math.round(s.accuracy)}%`,
    rankValue: s.avgTime > 0 ? `${Math.round(s.avgTime)}秒` : undefined
  }));

  // 2. 努力家ランキング (累計正解数順)
  const sortedByCount = [...students].sort((a, b) => {
    if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
    if (Math.abs(b.accuracy - a.accuracy) > 0.01) return b.accuracy - a.accuracy;
    return a.avgTime - b.avgTime;
  });

  const topCount = sortedByCount.map(s => ({
    uid: s.uid, 
    userName: s.userName, 
    value: s.correctCount, 
    displayValue: `${s.correctCount}問`,
    rankValue: `${s.unitCount}単元`
  }));

  const worstCount = [...sortedByCount].reverse().map(s => ({
    uid: s.uid, 
    userName: s.userName, 
    value: s.correctCount, 
    displayValue: `${s.correctCount}問`,
    rankValue: `${s.unitCount}単元`
  }));

  return {
    topAccuracy: topAcc,
    worstAccuracy: worstAcc,
    topCorrect: topCount,
    worstCorrect: worstCount
  };
}

// ============================================
// 問題レベル統計の構築
// ============================================

export function buildQuestionStats(
  questions: Array<{ id: string; question_text: string }>,
  statsDoc: Record<string, any>
): QuestionStat[] {
  return questions.map((q) => {
    const { total, correct } = getQuestionStatValue(statsDoc, q.id);
    const rate = total > 0 ? (correct / total) * 100 : 0;

    return {
      qId: q.id,
      questionText: q.question_text || '',
      total,
      correct,
      rate,
      difficulty: classifyDifficulty(rate),
    };
  });
}

// ============================================
// アクションサジェスト生成
// ============================================

export function generateActionSuggestions(
  questionStats: QuestionStat[],
  correlationPairs: CorrelationPair[]
): ActionSuggestion[] {
  const suggestions: ActionSuggestion[] = [];
  const attempted = questionStats.filter(q => q.total > 0);

  // 要確認: 正答率が低い問題
  const veryHard = attempted.filter(q => q.rate < 20);
  for (const q of veryHard) {
    suggestions.push({
      type: 'warning',
      icon: '🔴',
      title: `要点検: 正答率 ${Math.round(q.rate)}% (ID: ${q.qId})`,
      description: `この問題の正答率が非常に低いです。クラス全体で解説を行ってください。`,
      targetQId: q.qId,
      fullText: q.questionText,
    });
  }

  const strongPositive = correlationPairs.filter(p => p.direction === 'positive' && p.strength === 'strong');
  for (const pair of strongPositive.slice(0, 3)) {
    suggestions.push({
      type: 'warning',
      icon: '🔗',
      title: `連鎖ミスの傾向: Q${pair.indexA + 1} と Q${pair.indexB + 1}`,
      description: `この2問は同時に間違える傾向が強いです。共通する論点の理解が不十分な可能性があります。`,
    });
  }

  return suggestions;
}

// ============================================
// 正答率分布ヒストグラム用データ生成
// ============================================

export interface DistributionBin {
  range: string;
  count: number;
  label: string;
}

export function calculateAccuracyDistribution(questionStats: QuestionStat[]): DistributionBin[] {
  const bins: DistributionBin[] = [
    { range: '0-20%', count: 0, label: '非常に難しい' },
    { range: '20-40%', count: 0, label: '難しい' },
    { range: '40-60%', count: 0, label: '標準' },
    { range: '60-80%', count: 0, label: '易しい' },
    { range: '80-100%', count: 0, label: '非常に易しい' },
  ];

  const attempted = questionStats.filter(q => q.total > 0);
  for (const q of attempted) {
    if (q.rate < 20) bins[0].count++;
    else if (q.rate < 40) bins[1].count++;
    else if (q.rate < 60) bins[2].count++;
    else if (q.rate < 80) bins[3].count++;
    else bins[4].count++;
  }

  return bins;
}
