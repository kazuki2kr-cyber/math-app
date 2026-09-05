import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { getFunctions } from 'firebase-admin/functions';
import { createHash } from 'crypto';
import { answer, advance, BattleStateError, DISCONNECT_GRACE_MS, join, KanjiRoom, leave, member, members, ROOM_TTL_MS, start, touch } from './kanjiBattleState';

type Room = KanjiRoom & { presence?: Record<string, Record<string, { connected: boolean; at: number }>> };
const region = functions.region('us-central1');
const roomRef = (id: string) => admin.database().ref(`kanjiBattleRooms/${id}`);
function parseId(value: unknown) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) throw new functions.https.HttpsError('invalid-argument', 'ルームIDが不正です。');
  return value;
}
async function access(context: functions.https.CallableContext) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'ログインしてください。');
  const { uid, token } = context.auth;
  if (!(token.admin === true || token.appAccess === true || String(token.email || '').toLowerCase().endsWith('@shibaurafzk.com'))) {
    throw new functions.https.HttpsError('permission-denied', '利用権限がありません。');
  }
  const snap = await admin.firestore().doc(`users/${uid}`).get();
  const profile = snap.data();
  if (profile?.kanjiAccessGranted !== true || profile?.kanjiAccessBlocked === true) throw new functions.https.HttpsError('permission-denied', '漢字モードの利用権限がありません。');
  const name = String(profile?.displayName || profile?.name || token.name || 'Player').slice(0, 40);
  return { uid, name: name.includes('@') ? 'Player' : name };
}
export async function mutateKanjiRoom(id: string, change: (room: Room) => Room): Promise<Room> {
  try {
    let rejection: unknown;
    const result = await roomRef(id).transaction((room: Room | null) => {
      rejection = undefined;
      // RTDB may first invoke the callback with an empty local cache. Returning
      // null lets the server compare-and-retry with its actual room value.
      if (!room) return null;
      try {
        if (room.schemaVersion !== 2) throw new BattleStateError('画面を更新して新しいルームを作成してください。');
        const version = room.version;
        const next = change(room);
        return next.version === version ? undefined : next;
      } catch (error) {
        // Retry callbacks run on the SDK event loop: do not throw out of them.
        rejection = error;
        return undefined;
      }
    });
    if (rejection) throw rejection;
    if (!result.snapshot.exists()) throw new BattleStateError('ルームが見つかりません。');
    return result.snapshot.val() as Room;
  } catch (error) {
    if (error instanceof BattleStateError) throw new functions.https.HttpsError('failed-precondition', error.message);
    throw error;
  }
}

export const createKanjiBattleRoom = region.https.onCall(async (data, context) => {
  const { uid, name } = await access(context);
  if (typeof data?.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.requestId) || typeof data?.unitId !== 'string' || !/^[^/.#$\[\]]{1,120}$/.test(data.unitId)) {
    throw new functions.https.HttpsError('invalid-argument', '作成情報が不正です。');
  }
  const unit = (await admin.firestore().doc(`units/${data.unitId}`).get()).data();
  if (!unit || ![unit.subject, unit.baseSubject].some(s => s === 'kanji' || s === '漢字')) throw new functions.https.HttpsError('failed-precondition', '漢字単元を選択してください。');
  const questionCount = Array.isArray(unit.questions) && unit.questions.length
    ? unit.questions.length : (await admin.firestore().collection(`units/${data.unitId}/questions`).limit(10).get()).size;
  if (questionCount < 10) throw new functions.https.HttpsError('failed-precondition', '10問以上ある単元を選択してください。');
  // Stable per request: a lost response followed by retry cannot create two rooms.
  const matchId = createHash('sha256').update(`${uid}:${data.requestId}`).digest('hex');
  for (let attempt = 0; attempt < 10; attempt++) {
    const hash = createHash('sha256').update(`${matchId}:${attempt}`).digest('hex');
    const id = String(10_000_000 + parseInt(hash.slice(0, 10), 16) % 90_000_000);
    // Completed rooms may already have been removed by retention cleanup.
    // Never reuse their result/OCR idempotency keys for a different match.
    if ((await admin.firestore().doc(`kanji_battle_results/${id}`).get()).exists) continue;
    const now = Date.now();
    const result = await roomRef(id).transaction((existing: Room | null) => {
      if (existing) return undefined;
      return {
        schemaVersion: 2, matchId, unitId: data.unitId, unitTitle: String(unit.title || '漢字').slice(0, 120),
        hostUid: uid, status: 'waiting', phase: 'waiting', version: 1,
        createdAt: now, updatedAt: now, expiresAt: now + ROOM_TTL_MS,
        minPlayers: 2, maxPlayers: 4, questionCount: 10, currentQuestionIndex: 0,
        participants: { [uid]: { uid, name, joinedAt: now, ready: false, questionsReady: false, playReady: false, abandoned: false } },
      } satisfies KanjiRoom;
    });
    if (result.committed || result.snapshot.val()?.matchId === matchId) return { roomId: id };
  }
  throw new functions.https.HttpsError('resource-exhausted', 'ルームを作成できませんでした。');
});

export const joinKanjiBattleRoom = region.https.onCall(async (data, context) => {
  const { uid, name } = await access(context);
  const id = parseId(data?.roomId);
  await mutateKanjiRoom(id, r => join(r, uid, name, Date.now()));
  return { roomId: id };
});
export const leaveKanjiBattleRoom = region.https.onCall(async (data, context) => {
  const { uid } = await access(context);
  await mutateKanjiRoom(parseId(data?.roomId), r => advance(leave(r, uid, Date.now()), Date.now()));
  return { success: true };
});
export const readyKanjiBattleRoom = region.https.onCall(async (data, context) => {
  const { uid } = await access(context);
  await mutateKanjiRoom(parseId(data?.roomId), r => {
    const p = member(r, uid);
    if (data?.playReady === true) {
      if (r.status !== 'active' || r.phase !== 'loading' || !p.questionsReady) throw new BattleStateError('準備受付時間外です。');
      p.playReady = true;
    } else {
      if (r.status !== 'waiting' || r.phase !== 'waiting' || !p.questionsReady || typeof data?.ready !== 'boolean') throw new BattleStateError('問題の読み込み完了を待ってください。');
      p.ready = data.ready;
    }
    return advance(touch(r, Date.now()), Date.now());
  });
  return { success: true };
});
export const startKanjiBattleRoom = region.https.onCall(async (data, context) => {
  const { uid } = await access(context);
  await mutateKanjiRoom(parseId(data?.roomId), r => start(r, uid, Date.now()));
  return { success: true };
});
export const advanceKanjiBattleRoom = region.https.onCall(async (data, context) => {
  const { uid } = await access(context);
  await mutateKanjiRoom(parseId(data?.roomId), r => {
    member(r, uid);
    if (r.matchId !== data?.matchId || r.version !== data?.version) return r;
    return advance(r, Date.now());
  });
  return { success: true };
});
export const submitKanjiBattleAnswer = region.https.onCall(async (data, context) => {
  // Capture before Firestore authorization latency. Never accept a client clock.
  const receivedAt = Date.now();
  const { uid } = await access(context);
  const r = await mutateKanjiRoom(parseId(data?.roomId), room => {
    if (room.matchId !== data?.matchId) throw new BattleStateError('対戦が一致しません。');
    return answer(room, uid, data?.questionIndex, data?.questionId, receivedAt);
  });
  return { answer: r.questionAnswers?.[String(data.questionIndex)]?.[uid] };
});

async function enqueue(data: { roomId: string; matchId: string; version?: number; uid?: string }, when: number) {
  // Local tests dispatch deadlines explicitly for deterministic timing without
  // background tasks racing the fixtures. Production uses scheduled Cloud Tasks.
  if (process.env.FUNCTIONS_EMULATOR === 'true') return;
  await getFunctions().taskQueue('locations/us-central1/functions/kanjiBattleDeadline').enqueue(data, { scheduleTime: new Date(Math.max(Date.now(), when)) });
}
export async function dispatchKanjiDeadline(data: { roomId: string; matchId: string; version?: number; uid?: string }) {
  await mutateKanjiRoom(parseId(data.roomId), r => {
    if (r.matchId !== data.matchId) return r;
    const now = Date.now();
    if (data.uid) {
      const p = r.participants?.[data.uid];
      const connections = Object.values(r.presence?.[data.uid] || {});
      const lastSeen = Math.max(p?.joinedAt || 0, ...connections.map(c => c.at));
      if (p && !connections.some(c => c.connected) && lastSeen + DISCONNECT_GRACE_MS <= now) leave(r, data.uid, now);
    } else if (r.version !== data.version) return r;
    return advance(r, now);
  });
}
export const kanjiBattleDeadline = region.tasks.taskQueue({ retryConfig: { maxAttempts: 5, minBackoffSeconds: 2 } }).onDispatch(dispatchKanjiDeadline);

export const syncKanjiBattleRoom = region.runWith({ failurePolicy: true }).database.instance('math-app-26c77-default-rtdb').ref('/kanjiBattleRooms/{roomId}').onWrite(async (change, context) => {
  const after = change.after.val() as Room | null;
  const before = change.before.val() as Room | null;
  const id = context.params.roomId;
  if (after?.schemaVersion !== 2 && before?.schemaVersion !== 2) return;
  const latest = (await roomRef(id).get()).val() as Room | null;
  const listingRef = admin.database().ref(`kanjiBattleRoomListings/${id}`);
  await listingRef.transaction(current => {
    const version = latest?.version ?? Number.MAX_SAFE_INTEGER;
    if (current && current.version >= version) return undefined;
    const listed = latest && latest.status === 'waiting' && latest.phase === 'waiting' && latest.expiresAt > Date.now() && members(latest).length < 4;
    return listed ? {
      version, listedAt: latest.createdAt, hostName: latest.participants[latest.hostUid]?.name || 'Player',
      unitTitle: latest.unitTitle, participantCount: members(latest).length, maxPlayers: 4, expiresAt: latest.expiresAt,
    } : { version, listedAt: 0, expiresAt: latest?.expiresAt || Date.now() };
  });
  if (!after || ['completed', 'cancelled'].includes(after.status)) return;
  if (!before || after.version !== before.version) {
    await enqueue({ roomId: id, matchId: after.matchId, version: after.version }, after.phaseDeadlineMs || after.expiresAt);
  }
  // Presence changes also reach this trigger, but do not reset the phase deadline.
  for (const p of members(after)) {
    const connections = Object.values(after.presence?.[p.uid] || {});
    if (!connections.some(c => c.connected)) {
      const previous = before?.presence?.[p.uid];
      if (!before?.participants?.[p.uid] || JSON.stringify(previous || {}) !== JSON.stringify(after.presence?.[p.uid] || {})) {
        const lastSeen = Math.max(p.joinedAt, ...connections.map(c => c.at));
        await enqueue({ roomId: id, matchId: after.matchId, uid: p.uid }, lastSeen + DISCONNECT_GRACE_MS);
      }
    }
  }
});
