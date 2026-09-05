import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';

jest.setTimeout(60000);
const projectId = 'math-app-26c77';
const databaseURL = 'https://math-app-26c77-default-rtdb.asia-southeast1.firebasedatabase.app';
let env: RulesTestEnvironment;
const app = initializeApp({ projectId, databaseURL }, 'kanji-integration');
const database = getDatabase(app);
const firestore = getFirestore(app);
const actors: { uid: string; token: string }[] = [];
const rooms: string[] = [];
async function call(name: string, actor: number, data: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:5001/${projectId}/us-central1/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actors[actor].token}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  if (!res.ok || !('result' in body)) throw new Error(`Callable ${name} failed: ${res.status} ${JSON.stringify(body)}`);
  return body.result;
}
async function create() {
  const requestId = randomUUID();
  const result = await call('createKanjiBattleRoom', 0, { unitId: 'kanji-integration', requestId });
  rooms.push(result.roomId);
  return { roomId: result.roomId as string, requestId };
}
beforeAll(async () => {
  if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with run-kanji-battle-tests.js; emulator required.');
  env = await initializeTestEnvironment({ projectId, database: { host: '127.0.0.1', port: 9000, rules: readFileSync('database.rules.json', 'utf8') } });
  for (let i = 0; i < 6; i++) {
    const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `kanji-${randomUUID()}@shibaurafzk.com`, password: 'emulator-only-password', returnSecureToken: true }),
    });
    const data = await response.json();
    actors.push({ uid: data.localId, token: data.idToken });
    await firestore.doc(`users/${data.localId}`).set({ kanjiAccessGranted: true, displayName: '対戦テスト' + i });
  }
  await firestore.doc('units/kanji-integration').set({ subject: 'kanji', title: '漢字テスト', totalQuestions: 10,
    questions: Array.from({ length: 10 }, (_, i) => ({ id: 'q' + i, question_text: '「やま」を漢字で書く', answer: '山', order: i })),
  });
});
afterAll(async () => {
  for (const id of rooms) await database.ref(`kanjiBattleRooms/${id}`).remove();
  await env?.cleanup();
  await deleteApp(app);
});

test('simultaneous admission, reentry and direct writes cannot exceed four seats', async () => {
  const { roomId, requestId } = await create();
  expect((await call('createKanjiBattleRoom', 0, { unitId: 'kanji-integration', requestId })).roomId).toBe(roomId);
  await Promise.all([1, 2].map(i => call('joinKanjiBattleRoom', i, { roomId })));
  const attempts = await Promise.allSettled([3, 4, 5].map(i => call('joinKanjiBattleRoom', i, { roomId })));
  expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(Object.keys((await database.ref(`kanjiBattleRooms/${roomId}/participants`).get()).val())).toHaveLength(4);
  await call('joinKanjiBattleRoom', 1, { roomId });
  // Old abandoned record must not bypass capacity.
  await database.ref(`kanjiBattleRooms/${roomId}/participants/old-user`).set({ uid: 'old-user', abandoned: true });
  const hostDb = env.authenticatedContext(actors[0].uid, { email: 'host@shibaurafzk.com' }).database(databaseURL);
  const outsiderDb = env.authenticatedContext('old-user', { email: 'old@shibaurafzk.com' }).database(databaseURL);
  await assertFails(hostDb.ref(`kanjiBattleRooms/${roomId}/maxPlayers`).set(9));
  await assertFails(outsiderDb.ref(`kanjiBattleRooms/${roomId}/participants/old-user`).set({ uid: 'old-user', abandoned: false }));
  await assertFails(hostDb.ref(`kanjiBattleRooms/${roomId}/questionAnswers/0/${actors[0].uid}`).set({ responseMs: 0 }));
  await assertFails(hostDb.ref(`kanjiBattleRooms/${roomId}/playerScores/${actors[0].uid}`).set({ score: 9999 }));
  await assertFails(hostDb.ref(`kanjiBattleRooms/${roomId}/results/${actors[0].uid}`).set({ score: 9999 }));
  await assertSucceeds(hostDb.ref(`kanjiBattleRooms/${roomId}`).get());
  const strangerDb = env.authenticatedContext('stranger', { email: 'stranger@shibaurafzk.com' }).database(databaseURL);
  await assertFails(strangerDb.ref(`kanjiBattleRooms/${roomId}`).get());
  await assertSucceeds(strangerDb.ref('kanjiBattleRoomListings').get());
  await assertFails(strangerDb.ref(`kanjiBattleRoomListings/${roomId}`).set({ listedAt: 1 }));
  await assertFails(env.unauthenticatedContext().database(databaseURL).ref('kanjiBattleRoomListings').get());
});

test('actual callable flow prepares, starts and records ten server-timed answers', async () => {
  const { roomId } = await create();
  await call('joinKanjiBattleRoom', 1, { roomId });
  const questionResults = await Promise.all([0, 1].map(i => call('getKanjiBattleQuestions', i, { roomId })));
  expect(questionResults[0].questions).toHaveLength(10);
  expect(questionResults[0].questions[0].answer).toBeUndefined();
  await Promise.all([0, 1].map(i => call('readyKanjiBattleRoom', i, { roomId, ready: true })));
  await call('startKanjiBattleRoom', 0, { roomId });
  await expect(call('joinKanjiBattleRoom', 2, { roomId })).rejects.toThrow('募集');
  const rr = database.ref(`kanjiBattleRooms/${roomId}`);
  // Move only test fixture deadlines, avoiding a six-minute wall-clock test.
  await rr.update({ phaseDeadlineMs: Date.now() - 1 });
  let r = (await rr.get()).val();
  await call('advanceKanjiBattleRoom', 0, { roomId, matchId: r.matchId, version: r.version });
  await Promise.all([0, 1].map(i => call('readyKanjiBattleRoom', i, { roomId, playReady: true })));
  r = (await rr.get()).val();
  await expect(call('submitKanjiBattleAnswer', 0, { roomId, matchId: r.matchId, questionIndex: 0, questionId: r.questionIds[0] })).rejects.toThrow('受付');
  for (let qi = 0; qi < 10; qi++) {
    r = (await rr.get()).val();
    const startsAt = Date.now() - 4500;
    await rr.update({ questionStartedAtMs: startsAt, phaseDeadlineMs: startsAt + 30000,
      [`questionTimings/${qi}`]: { startsAtMs: startsAt, deadlineAtMs: startsAt + 30000 } });
    const result = await call('submitKanjiBattleAnswer', 0, { roomId, matchId: r.matchId, questionIndex: qi, questionId: r.questionIds[qi], responseMs: 0 });
    expect(result.answer.responseMs).toBeGreaterThanOrEqual(4500);
    const again = await call('submitKanjiBattleAnswer', 0, { roomId, matchId: r.matchId, questionIndex: qi, questionId: r.questionIds[qi] });
    expect(again.answer.responseMs).toBe(result.answer.responseMs);
    await call('submitKanjiBattleAnswer', 1, { roomId, matchId: r.matchId, questionIndex: qi, questionId: r.questionIds[qi] });
    r = (await rr.get()).val();
    expect(r.phase).toBe('countdown');
    await rr.update({ phaseDeadlineMs: Date.now() - 1 });
    await call('advanceKanjiBattleRoom', 0, { roomId, matchId: r.matchId, version: r.version });
  }
  r = (await rr.get()).val();
  expect(r.status).toBe('completed');
  expect(Object.keys(r.questionAnswers)).toHaveLength(10);
});

test('ready is not membership, starting and leaving race safely; presence only permits own data', async () => {
  const { roomId } = await create();
  await expect(call('readyKanjiBattleRoom', 2, { roomId, ready: true })).rejects.toThrow('参加');
  const rr = database.ref(`kanjiBattleRooms/${roomId}`);
  await call('joinKanjiBattleRoom', 1, { roomId });
  await Promise.all([0, 1].map(i => call('getKanjiBattleQuestions', i, { roomId })));
  await Promise.all([0, 1].map(i => call('readyKanjiBattleRoom', i, { roomId, ready: true })));
  await Promise.allSettled([call('startKanjiBattleRoom', 0, { roomId }), call('leaveKanjiBattleRoom', 1, { roomId })]);
  expect((await rr.get()).val().phase).toBe('waiting');
  const hostDb = env.authenticatedContext(actors[0].uid, { email: 'host@shibaurafzk.com' }).database(databaseURL);
  await assertSucceeds(hostDb.ref(`kanjiBattleRooms/${roomId}/presence/${actors[0].uid}/tab`).set({ connected: true, at: { '.sv': 'timestamp' } }));
  await assertFails(hostDb.ref(`kanjiBattleRooms/${roomId}/presence/${actors[1].uid}/tab`).set({ connected: true, at: { '.sv': 'timestamp' } }));
  await assertFails(hostDb.ref(`kanjiBattleRooms/${roomId}/presence/${actors[0].uid}/tab`).set({ connected: true, at: Date.now() + 60000 }));
  await call('leaveKanjiBattleRoom', 0, { roomId });
  expect((await rr.get()).val().status).toBe('cancelled');
});
