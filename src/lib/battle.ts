export const BATTLE_ACCESS_STORAGE_KEY = 'battle_mode_access_granted';
export const BATTLE_ACCESS_PASSWORD = process.env.NEXT_PUBLIC_BATTLE_ACCESS_PASSWORD || 'test';
export const BATTLE_ROOM_TTL_MS = 60 * 60 * 1000;
export const BATTLE_QUESTION_COUNT = 10;
export const BATTLE_BASE_SCORE = 100;
export const BATTLE_ANSWER_LIMIT_MS = 30000;
export const BATTLE_NEXT_QUESTION_COUNTDOWN_MS = 5000;
export const BATTLE_MAX_SPEED_BONUS = 15;
export const BATTLE_FAST_BONUS_MS = 3000;
export const BATTLE_BONUS_LIMIT_MS = BATTLE_ANSWER_LIMIT_MS;
export const BATTLE_XP_PER_RANK = 500;

export const BATTLE_XP_TABLE: Record<number, number[]> = {
  2: [100, -20],
  3: [125, 0, -20],
  4: [150, 75, -20, -40],
};

export const BATTLE_RANKS = [
  { minXp: 0, title: 'ベーシッククラス', icon: '🥉' },
  { minXp: 500, title: 'ブロンズクラス', icon: '🥈' },
  { minXp: 1000, title: 'シルバークラス', icon: '🥇' },
  { minXp: 1500, title: 'ゴールドクラス', icon: '🏅' },
  { minXp: 2000, title: 'プラチナクラス', icon: '💎' },
  { minXp: 2500, title: 'マスタークラス', icon: '👑' },
] as const;

export interface BattleProfile {
  wins: number;
  xp: number;
}

export interface BattleRankResult {
  minXp: number;
  title: string;
  icon: string;
}

export interface BattleResultEntry {
  uid: string;
  name: string;
  totalScore: number;
  correctCount: number;
  totalQuestions: number;
  totalTimeMs: number;
  finishedAt?: number;
}

export function getBattleRank(xp: number): BattleRankResult {
  return [...BATTLE_RANKS].reverse().find(rank => xp >= rank.minXp) || BATTLE_RANKS[0];
}

export function getNextBattleRank(xp: number): BattleRankResult | null {
  return BATTLE_RANKS.find(rank => rank.minXp > xp) || null;
}

export function calculateBattleSpeedBonus(responseMs: number): number {
  const safeResponseMs = Math.min(BATTLE_ANSWER_LIMIT_MS, Math.max(0, responseMs));
  if (safeResponseMs <= BATTLE_FAST_BONUS_MS) return BATTLE_MAX_SPEED_BONUS;
  if (safeResponseMs >= BATTLE_BONUS_LIMIT_MS) return 0;
  const ratio = (BATTLE_BONUS_LIMIT_MS - safeResponseMs) / (BATTLE_BONUS_LIMIT_MS - BATTLE_FAST_BONUS_MS);
  return Math.max(0, Math.round(BATTLE_MAX_SPEED_BONUS * ratio));
}

export function calculateBattleQuestionScore(correct: boolean, responseMs: number): number {
  if (!correct) return 0;
  return BATTLE_BASE_SCORE + calculateBattleSpeedBonus(responseMs);
}

export function getBattleXpDelta(playerCount: number, rankIndex: number): number {
  const table = BATTLE_XP_TABLE[Math.min(4, Math.max(2, playerCount))] || BATTLE_XP_TABLE[2];
  return table[rankIndex] ?? table[table.length - 1] ?? 0;
}

export function sortBattleResults(results: BattleResultEntry[]): BattleResultEntry[] {
  return [...results].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (a.totalTimeMs !== b.totalTimeMs) return a.totalTimeMs - b.totalTimeMs;
    return String(a.finishedAt || 0).localeCompare(String(b.finishedAt || 0));
  });
}
