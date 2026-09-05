// Pure state transitions: the same room transaction serializes admission and play.
export const ANSWER_MS = 30_000;
export const INTERMISSION_MS = 3_000;
export const ROOM_TTL_MS = 60 * 60_000;
export const DISCONNECT_GRACE_MS = 15_000;

export interface KanjiMember {
  uid: string;
  name: string;
  joinedAt: number;
  ready: boolean;
  questionsReady: boolean;
  playReady: boolean;
  abandoned: boolean;
}
export interface KanjiAnswer {
  uid: string;
  questionId: string;
  responseMs: number;
  answeredAtMs: number;
  submitted: true;
  timedOut: boolean;
  serverVerified: true;
}
export interface KanjiRoom {
  schemaVersion: 2;
  matchId: string;
  hostUid: string;
  unitId: string;
  unitTitle: string;
  status: 'waiting' | 'active' | 'completed' | 'cancelled';
  phase: 'waiting' | 'starting' | 'loading' | 'answering' | 'countdown' | 'completed';
  version: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  maxPlayers: 4;
  minPlayers: 2;
  questionCount: 10;
  currentQuestionIndex: number;
  questionStartedAtMs?: number;
  countdownStartedAtMs?: number;
  completedAt?: number;
  phaseDeadlineMs?: number;
  participants: Record<string, KanjiMember>;
  questionIds?: string[];
  questionTimings?: Record<string, { startsAtMs: number; deadlineAtMs: number }>;
  questionAnswers?: Record<string, Record<string, KanjiAnswer>>;
}
export class BattleStateError extends Error {}
function fail(message: string): never { throw new BattleStateError(message); }
export function members(room: KanjiRoom) {
  return Object.values(room.participants || {}).filter(p => !p.abandoned);
}
export function member(room: KanjiRoom, uid: string) {
  const p = room.participants?.[uid];
  if (!p || p.abandoned) fail('このルームに参加していません。');
  return p;
}
export function touch(room: KanjiRoom, now: number) {
  room.version += 1;
  room.updatedAt = now;
  return room;
}
export function join(room: KanjiRoom, uid: string, name: string, now: number) {
  if (room.participants?.[uid] && !room.participants[uid].abandoned) return room;
  if (room.status !== 'waiting' || room.phase !== 'waiting' || room.expiresAt <= now) fail('このルームの募集は終了しました。');
  if (members(room).length >= 4) fail('このルームは満員です。');
  room.participants[uid] = { uid, name, joinedAt: now, ready: false, questionsReady: false, playReady: false, abandoned: false };
  return touch(room, now);
}
export function leave(room: KanjiRoom, uid: string, now: number) {
  if (!room.participants?.[uid] || room.participants[uid].abandoned || ['completed', 'cancelled'].includes(room.status)) return room;
  if (room.status === 'waiting') {
    if (room.hostUid === uid) {
      room.status = 'cancelled';
    } else {
      delete room.participants[uid];
      room.phase = 'waiting';
      delete room.phaseDeadlineMs;
      Object.values(room.participants).forEach(p => { p.ready = false; });
    }
  } else {
    room.participants[uid].abandoned = true;
    if (members(room).length === 0) room.status = 'cancelled';
  }
  return touch(room, now);
}
export function start(room: KanjiRoom, uid: string, now: number) {
  if (room.hostUid !== uid) fail('ホストだけが開始できます。');
  if (room.status !== 'waiting' || room.phase !== 'waiting' || room.expiresAt <= now) fail('開始できる状態ではありません。');
  const players = members(room);
  if (players.length < 2 || players.length > 4 || !players.every(p => p.ready && p.questionsReady)) fail('2〜4人全員の準備完了を待ってください。');
  // Discard departed historical members before freezing the roster for scoring.
  room.participants = Object.fromEntries(players.map(p => [p.uid, p]));
  room.phase = 'starting';
  room.countdownStartedAtMs = now;
  room.phaseDeadlineMs = now + INTERMISSION_MS;
  return touch(room, now);
}
function openQuestion(room: KanjiRoom, startsAtMs: number) {
  room.phase = 'answering';
  room.questionStartedAtMs = startsAtMs;
  room.phaseDeadlineMs = startsAtMs + ANSWER_MS;
  room.questionTimings ||= {};
  room.questionTimings[String(room.currentQuestionIndex)] = { startsAtMs, deadlineAtMs: startsAtMs + ANSWER_MS };
}
export function advance(room: KanjiRoom, now: number) {
  if (room.status === 'completed' || room.status === 'cancelled') return room;
  const players = members(room);
  if (room.status === 'waiting' && room.expiresAt <= now) {
    room.status = 'cancelled';
    return touch(room, now);
  }
  if (room.phase === 'starting' && now >= Number(room.phaseDeadlineMs)) {
    if (players.length < 2 || players.length > 4 || !players.every(p => p.ready && p.questionsReady)) {
      room.phase = 'waiting';
      delete room.phaseDeadlineMs;
    } else {
      room.status = 'active';
      room.phase = 'loading';
      room.phaseDeadlineMs = now + 60_000;
    }
    return touch(room, now);
  }
  if (room.phase === 'loading') {
    if (players.length && players.every(p => p.playReady)) {
      openQuestion(room, now + INTERMISSION_MS);
      return touch(room, now);
    }
    if (now >= Number(room.phaseDeadlineMs)) {
      room.status = 'cancelled';
      return touch(room, now);
    }
  }
  if (room.phase === 'answering') {
    const qi = String(room.currentQuestionIndex);
    const answers = room.questionAnswers?.[qi] || {};
    const deadline = Number(room.phaseDeadlineMs);
    const allAnswered = players.length > 0 && players.every(p => !!answers[p.uid]);
    if (now >= deadline || allAnswered) {
      room.questionAnswers ||= {};
      room.questionAnswers[qi] ||= {};
      for (const p of players) {
        room.questionAnswers[qi][p.uid] ||= {
          uid: p.uid, questionId: room.questionIds![room.currentQuestionIndex], responseMs: ANSWER_MS,
          answeredAtMs: deadline, submitted: true, timedOut: true, serverVerified: true,
        };
      }
      room.phase = 'countdown';
      room.countdownStartedAtMs = now;
      room.phaseDeadlineMs = now + INTERMISSION_MS;
      return touch(room, now);
    }
  }
  if (room.phase === 'countdown' && now >= Number(room.phaseDeadlineMs)) {
    if (room.currentQuestionIndex >= room.questionCount - 1) {
      room.status = 'completed';
      room.phase = 'completed';
      room.completedAt = now;
      delete room.phaseDeadlineMs;
    } else {
      room.currentQuestionIndex += 1;
      // A delayed worker does not consume the next question's answer time.
      openQuestion(room, now);
    }
    return touch(room, now);
  }
  return room;
}
export function answer(room: KanjiRoom, uid: string, index: number, questionId: string, now: number) {
  member(room, uid);
  if (!Number.isInteger(index) || index < 0 || index >= 10 || room.questionIds?.[index] !== questionId) fail('問題が一致しません。');
  const existing = room.questionAnswers?.[String(index)]?.[uid];
  if (existing) return room;
  const timing = room.questionTimings?.[String(index)];
  if (room.status !== 'active' || room.phase !== 'answering' || room.currentQuestionIndex !== index || !timing || now < timing.startsAtMs) fail('回答受付時間外です。');
  // Arrival time is authoritative. Late arrivals have no speed bonus.
  room.questionAnswers ||= {};
  room.questionAnswers[String(index)] ||= {};
  room.questionAnswers[String(index)][uid] = {
    uid, questionId, responseMs: Math.min(ANSWER_MS, now - timing.startsAtMs),
    answeredAtMs: now, submitted: true, timedOut: now >= timing.deadlineAtMs, serverVerified: true,
  };
  touch(room, now);
  return advance(room, now);
}
