import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export const KANJI_BATTLE_ACCESS_STORAGE_KEY = 'kanji_battle_mode_access_granted';
export const KANJI_BATTLE_ACCESS_PASSWORD = process.env.NEXT_PUBLIC_KANJI_BATTLE_ACCESS_PASSWORD || 'test';
export const BATTLE_QUESTION_COUNT = 10;
export const BATTLE_ANSWER_LIMIT_MS = 30_000;
export const BATTLE_NEXT_QUESTION_COUNTDOWN_MS = 3_000;
export const BATTLE_XP_PER_RANK = 500;

export const BATTLE_XP_TABLE: Record<number, number[]> = {
  2: [100, -20],
  3: [125, 0, -20],
  4: [150, 75, -20, -40],
};

export const BATTLE_RANKS = [
  { minXp: 0, title: 'ベーシッククラス', icon: '🔰' },
  { minXp: 500, title: 'ブロンズクラス', icon: '🥉' },
  { minXp: 1000, title: 'シルバークラス', icon: '🥈' },
  { minXp: 1500, title: 'ゴールドクラス', icon: '🥇' },
  { minXp: 2000, title: 'プラチナクラス', icon: '💎' },
  { minXp: 2500, title: 'マスタークラス', icon: '👑' },
] as const;

export interface BattleResultEntry {
  uid: string;
  name: string;
  totalScore: number;
  correctCount: number;
  totalQuestions: number;
  totalTimeMs: number;
  abandoned?: boolean;
  rank?: number;
  xpDelta?: number;
  finishedAt?: number;
}

export function getBattleRank(xp: number) {
  return [...BATTLE_RANKS].reverse().find(rank => xp >= rank.minXp) || BATTLE_RANKS[0];
}

export function getNextBattleRank(xp: number) {
  return BATTLE_RANKS.find(rank => rank.minXp > xp) || null;
}

export function getBattleXpDelta(playerCount: number, rankIndex: number): number {
  const table = BATTLE_XP_TABLE[Math.min(4, Math.max(2, playerCount))] || BATTLE_XP_TABLE[2];
  return table[rankIndex] ?? table[table.length - 1] ?? 0;
}

export function sortBattleResults(results: BattleResultEntry[]): BattleResultEntry[] {
  return [...results].sort((a, b) => {
    if (!!a.abandoned !== !!b.abandoned) return a.abandoned ? 1 : -1;
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (a.totalTimeMs !== b.totalTimeMs) return a.totalTimeMs - b.totalTimeMs;
    return String(a.finishedAt || 0).localeCompare(String(b.finishedAt || 0));
  });
}

export const KANJI_ANSWER_MS = 30_000;
export const KANJI_INTERVAL_MS = 3_000;
export interface KanjiBattleParticipant {
  uid: string; name: string; abandoned?: boolean; ready?: boolean; questionsReady?: boolean; playReady?: boolean;
}
export interface KanjiBattleRoom {
  schemaVersion: number;
  matchId: string;
  version: number;
  hostUid: string;
  unitId: string;
  unitTitle: string;
  status: 'waiting' | 'active' | 'completed' | 'cancelled';
  phase: 'waiting' | 'starting' | 'loading' | 'answering' | 'countdown' | 'completed';
  participants: Record<string, KanjiBattleParticipant>;
  phaseDeadlineMs?: number;
  questionStartedAtMs?: number;
  currentQuestionIndex: number;
}
export interface KanjiRoomListing {
  roomId: string; hostName: string; unitTitle: string; participantCount: number; maxPlayers: number;
  listedAt: number; expiresAt: number;
}
export async function kanjiBattleCall<T = { success: boolean }>(name: string, data: Record<string, unknown>): Promise<T> {
  return (await httpsCallable<Record<string, unknown>, T>(functions, name)(data)).data;
}
export function kanjiBattleError(error: unknown) {
  return error instanceof Error ? error.message.replace(/^Firebase:\s*/, '') : '通信に失敗しました。もう一度お試しください。';
}
export function canAnswerKanji(room: { status?: string; phase?: string; questionStartedAtMs?: number; phaseDeadlineMs?: number } | null, now: number, synchronized: boolean) {
  return !!room && synchronized && room.status === 'active' && room.phase === 'answering'
    && Number.isFinite(room.questionStartedAtMs) && Number.isFinite(room.phaseDeadlineMs)
    && now >= Number(room.questionStartedAtMs) && now < Number(room.phaseDeadlineMs);
}
