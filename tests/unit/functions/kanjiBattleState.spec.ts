import { advance, answer, join, KanjiRoom, leave, members, start } from '../../../functions/src/kanjiBattleState';

export function makeRoom(): KanjiRoom {
  return {
    schemaVersion: 2, matchId: 'match', hostUid: 'host', unitId: 'unit', unitTitle: '漢字',
    status: 'waiting', phase: 'waiting', version: 1, createdAt: 1000, updatedAt: 1000, expiresAt: 3_601_000,
    maxPlayers: 4, minPlayers: 2, questionCount: 10, currentQuestionIndex: 0,
    participants: { host: { uid: 'host', name: 'Host', joinedAt: 1000, ready: false, questionsReady: false, playReady: false, abandoned: false } },
    questionIds: Array.from({ length: 10 }, (_, i) => 'q' + i),
  };
}
function playing() {
  const room = makeRoom();
  join(room, 'guest', 'Guest', 1000);
  Object.values(room.participants).forEach(p => { p.ready = true; p.questionsReady = true; p.playReady = true; });
  start(room, 'host', 1000);
  advance(room, 4000);
  advance(room, 4000);
  return room;
}
describe('Kanji battle admission and authoritative time', () => {
  test('fifth admission and abandoned member re-entry cannot bypass capacity', () => {
    const r = makeRoom();
    for (const id of ['b', 'c', 'd']) join(r, id, id, 1000);
    expect(() => join(r, 'e', 'e', 1000)).toThrow('満員');
    r.participants.e = { ...r.participants.b, uid: 'e', abandoned: true };
    expect(() => join(r, 'e', 'e', 1000)).toThrow('満員');
    join(r, 'b', 'b', 1000);
    expect(members(r)).toHaveLength(4);
  });
  test('starting closes admission and departure cancels the countdown', () => {
    const r = playing();
    expect(() => join(r, 'c', 'c', 5000)).toThrow('募集');
    const waiting = makeRoom();
    join(waiting, 'b', 'b', 1000);
    Object.values(waiting.participants).forEach(p => { p.ready = true; p.questionsReady = true; });
    start(waiting, 'host', 1000);
    expect(() => join(waiting, 'c', 'c', 1001)).toThrow('募集');
    leave(waiting, 'b', 1001);
    advance(waiting, 5000);
    expect(waiting.phase).toBe('waiting');
    expect(waiting.participants.host.ready).toBe(false);
  });
  test('early submission is rejected instead of clamped to zero', () => {
    const r = playing();
    expect(r.questionStartedAtMs).toBe(7000);
    expect(() => answer(r, 'host', 0, 'q0', 6999)).toThrow('受付');
    expect(r.questionAnswers).toBeUndefined();
    answer(r, 'host', 0, 'q0', 8240);
    expect(r.questionAnswers!['0'].host.responseMs).toBe(1240);
    answer(r, 'host', 0, 'q0', 9000);
    expect(r.questionAnswers!['0'].host.responseMs).toBe(1240);
  });
  test('all answers advance early, with exactly three seconds between questions', () => {
    const r = playing();
    answer(r, 'host', 0, 'q0', 8000);
    answer(r, 'guest', 0, 'q0', 9000);
    expect(r.phase).toBe('countdown');
    advance(r, 11999);
    expect(r.currentQuestionIndex).toBe(0);
    advance(r, 12000);
    expect(r.questionStartedAtMs).toBe(12000);
    expect(r.currentQuestionIndex).toBe(1);
  });
  test('timeout is 30s, stale question cannot overwrite the next, all ten complete', () => {
    const r = playing();
    for (let qi = 0; qi < 10; qi++) {
      advance(r, r.phaseDeadlineMs!);
      expect(r.questionAnswers![String(qi)].host.responseMs).toBe(30000);
      expect(r.questionAnswers![String(qi)].guest.timedOut).toBe(true);
      advance(r, r.phaseDeadlineMs!);
    }
    expect(r.status).toBe('completed');
    answer(r, 'host', 0, 'q0', 999999);
    expect(r.questionAnswers!['0'].host.responseMs).toBe(30000);
    expect(() => answer(r, 'host', 0, 'wrong-id', 999999)).toThrow('一致');
  });
  test('late worker gives next question its full answer window', () => {
    const r = playing();
    advance(r, 60000);
    advance(r, 90000);
    expect(r.phaseDeadlineMs! - r.questionStartedAtMs!).toBe(30000);
  });
  test('host departure dissolves a waiting room and nonmember cannot answer', () => {
    const r = makeRoom();
    leave(r, 'host', 2000);
    expect(r.status).toBe('cancelled');
    expect(() => answer(playing(), 'intruder', 0, 'q0', 8000)).toThrow('参加');
  });
});
