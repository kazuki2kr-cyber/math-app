import { randomUUID } from 'crypto';

// Vision itself is an external paid API. Everything after its response (layout,
// grading, trusted response times, RTDB, Firestore and XP) runs for real locally.
const mockVision = jest.fn();
jest.mock('../functions/node_modules/@google-cloud/vision', () => ({
  ImageAnnotatorClient: jest.fn().mockImplementation(() => ({ documentTextDetection: mockVision })),
}));

jest.setTimeout(60000);
let api: typeof import('../functions/src/index');
let admin: typeof import('firebase-admin');
let roomId: string;
const uids = ['ocr-host', 'ocr-guest'];
const extraRooms: string[] = [];
const context = (uid: string) => ({ auth: { uid, token: { email: `${uid}@shibaurafzk.com` } } });
// The .run hooks execute the same callable handlers, with authorization fixtures.
const run = (name: string, data: unknown, uid: string) => (api as unknown as Record<string, { run: (data: unknown, context: unknown) => Promise<any> }>)[name].run(data, context(uid));
beforeAll(async () => {
  if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulators required');
  admin = require('../functions/node_modules/firebase-admin');
  api = require('../functions/lib/index');
  await Promise.all(uids.map(uid => admin.firestore().doc(`users/${uid}`).set({ kanjiAccessGranted: true, name: uid })));
  await admin.firestore().doc('units/ocr-battle-test').set({ subject: 'kanji', title: 'OCRテスト',
    questions: Array.from({ length: 10 }, (_, i) => ({ id: 'q' + i, question_text: 'やま', answer: '山' })),
  });
  roomId = (await run('createKanjiBattleRoom', { unitId: 'ocr-battle-test', requestId: randomUUID() }, uids[0])).roomId;
  await run('joinKanjiBattleRoom', { roomId }, uids[1]);
  await Promise.all(uids.map(uid => run('getKanjiBattleQuestions', { roomId }, uid)));
});
afterAll(async () => {
  if (roomId) await admin.database().ref(`kanjiBattleRooms/${roomId}`).remove();
  for (const id of extraRooms) await admin.database().ref(`kanjiBattleRooms/${id}`).remove();
  if (admin?.apps.length) await Promise.all(admin.apps.map(app => app?.delete()));
});

test('disconnect recovery respects multiple tabs, grace period and stale phase versions', async () => {
  const id = (await run('createKanjiBattleRoom', { unitId: 'ocr-battle-test', requestId: randomUUID() }, uids[0])).roomId;
  extraRooms.push(id);
  await run('joinKanjiBattleRoom', { roomId: id }, uids[1]);
  const rr = admin.database().ref(`kanjiBattleRooms/${id}`);
  const r = (await rr.get()).val();
  await rr.child(`presence/${uids[1]}`).set({ a: { connected: false, at: Date.now() - 20000 }, b: { connected: true, at: Date.now() } });
  await run('kanjiBattleDeadline', { roomId: id, matchId: r.matchId, uid: uids[1] }, uids[0]);
  expect((await rr.child(`participants/${uids[1]}`).get()).exists()).toBe(true);
  await rr.child(`presence/${uids[1]}/b`).set({ connected: false, at: Date.now() });
  await run('kanjiBattleDeadline', { roomId: id, matchId: r.matchId, uid: uids[1] }, uids[0]);
  expect((await rr.child(`participants/${uids[1]}`).get()).exists()).toBe(true);
  await rr.child(`participants/${uids[1]}/joinedAt`).set(Date.now() - 30000);
  await rr.child(`presence/${uids[1]}/b`).set({ connected: false, at: Date.now() - 20000 });
  await run('kanjiBattleDeadline', { roomId: id, matchId: r.matchId, uid: uids[1] }, uids[0]);
  expect((await rr.child(`participants/${uids[1]}`).get()).exists()).toBe(false);
  await rr.update({ phase: 'starting', phaseDeadlineMs: Date.now() - 1 });
  await run('kanjiBattleDeadline', { roomId: id, matchId: r.matchId, version: -1 }, uids[0]);
  expect((await rr.child('phase').get()).val()).toBe('starting');
});

test('OCR grading uses server answers, rejects unverified time, and finalizes XP only once', async () => {
  const rr = admin.database().ref(`kanjiBattleRooms/${roomId}`);
  const room = (await rr.get()).val();
  const answers = Object.fromEntries(room.questionIds.map((id: string, i: number) => [i, Object.fromEntries(uids.map(uid => [uid, {
    uid, questionId: id, responseMs: uid === uids[0] ? 4500 : 30000,
    answeredAtMs: Date.now(), serverVerified: !(uid === uids[0] && i === 0), submitted: true, timedOut: uid === uids[1],
  }]))]));
  await rr.update({ status: 'completed', phase: 'completed', completedAt: Date.now(), questionAnswers: answers });
  const layout = room.questionIds.map((id: string, i: number) => ({ questionId: id, x: 0, y: i / 10, width: 1, height: 0.1,
    expectedCharCount: 1, slots: [{ index: 0, x: 0, y: i / 10, width: 1, height: 0.1 }],
  }));
  mockVision.mockResolvedValue([{ fullTextAnnotation: { pages: [{ width: 1000, height: 1000, blocks: [{ paragraphs: [{ words: [{
    symbols: Array.from({ length: 10 }, (_, i) => ({ text: '山', boundingBox: { vertices: [
      { x: 450, y: i * 100 + 20 }, { x: 500, y: i * 100 + 20 }, { x: 500, y: i * 100 + 70 }, { x: 450, y: i * 100 + 70 },
    ] } })),
  }] }] }] }] } }]);
  const payload = { roomId, questionIds: room.questionIds, composedImageBase64: 'data:image/png;base64,ZmFrZQ==', layout, responseMs: 0 };
  await Promise.all(uids.map(uid => run('submitKanjiBattleOcr', payload, uid)));
  expect((await run('submitKanjiBattleOcr', payload, uids[0])).alreadySubmitted).toBe(true);
  expect(mockVision).toHaveBeenCalledTimes(2);
  const scores = (await rr.child('playerScores').get()).val();
  expect(scores[uids[0]].correctCount).toBe(9);
  expect(scores[uids[0]].questionResults[0].speedBonus).toBe(0);
  expect(scores[uids[0]].questionResults[1].responseMs).toBe(4500);
  expect(scores[uids[1]].correctCount).toBe(10);
  expect(scores[uids[1]].totalTimeMs).toBe(300000);
  await run('finalizeKanjiBattleRoom', { roomId }, uids[0]);
  const first = (await admin.firestore().doc(`users/${uids[0]}`).get()).data();
  expect((await run('finalizeKanjiBattleRoom', { roomId }, uids[0])).alreadyFinalized).toBe(true);
  const second = (await admin.firestore().doc(`users/${uids[0]}`).get()).data();
  expect(second?.kanjiBattleStats).toEqual(first?.kanjiBattleStats);
  expect((await rr.child('finalizedAt').get()).exists()).toBe(true);
  expect(Object.keys((await rr.child('results').get()).val())).toHaveLength(2);
});

test('listing projection does not reopen a closed room when old events are replayed', async () => {
  const id = (await run('createKanjiBattleRoom', { unitId: 'ocr-battle-test', requestId: randomUUID() }, uids[0])).roomId;
  extraRooms.push(id);
  const rr = admin.database().ref(`kanjiBattleRooms/${id}`);
  const waiting = await rr.get();
  const project = (before: unknown, after: unknown) => (api.syncKanjiBattleRoom as unknown as {
    run: (change: unknown, context: unknown) => Promise<void>;
  }).run({ before, after }, { params: { roomId: id } });
  await project(waiting, waiting);
  const listing = admin.database().ref(`kanjiBattleRoomListings/${id}`);
  const summary = (await listing.get()).val();
  expect(summary.participantCount).toBe(1);
  expect(summary.hostName).toBe(uids[0]);
  expect(summary.participants).toBeUndefined();
  expect(summary.questionIds).toBeUndefined();
  await run('leaveKanjiBattleRoom', { roomId: id }, uids[0]);
  await project(waiting, await rr.get());
  const closed = (await listing.get()).val();
  expect(closed.listedAt).toBe(0);
  await project(waiting, waiting);
  expect((await listing.get()).val()).toEqual(closed);
});
