import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

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
