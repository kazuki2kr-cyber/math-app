import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { randomInt } from 'crypto';

export const ALL_KANJI_UNIT_ID = 'kanji-all-random';
export const POOL_ROOT = 'kanji_battle_pools';

// Immutable pool versions let existing rooms finish after a new version is published.
export async function selectPoolQuestions() {
  const active = (await admin.firestore().doc(`${POOL_ROOT}/active`).get()).data();
  if (!active || !/^[a-zA-Z0-9-]+$/.test(active.version) || !Number.isSafeInteger(active.count) || active.count < 10 || active.count >= 2 ** 48) {
    throw new functions.https.HttpsError('failed-precondition', '全単元出題セットが準備されていません。');
  }
  const slots = new Set<number>();
  while (slots.size < 10) slots.add(randomInt(active.count));
  return { poolVersion: String(active.version), poolSlots: [...slots] };
}

export async function loadPoolQuestions(room: { poolVersion?: string; poolSlots?: number[] }) {
  if (!room.poolVersion || !/^[a-zA-Z0-9-]+$/.test(room.poolVersion) || !Array.isArray(room.poolSlots)
    || room.poolSlots.length !== 10 || new Set(room.poolSlots).size !== 10
    || room.poolSlots.some(slot => !Number.isSafeInteger(slot) || slot < 0)) {
    throw new functions.https.HttpsError('failed-precondition', '全単元出題セットの情報が不正です。');
  }
  const snapshots = await admin.firestore().getAll(...room.poolSlots.map(slot =>
    admin.firestore().doc(`${POOL_ROOT}/${room.poolVersion}/questions/${slot}`)));
  if (snapshots.some(snapshot => !snapshot.exists)) {
    throw new functions.https.HttpsError('failed-precondition', '出題データが不足しています。');
  }
  return snapshots.map(snapshot => ({ ...snapshot.data(), id: `${room.poolVersion}-${snapshot.id}` }));
}
