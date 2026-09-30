import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
import { createHash } from "node:crypto";

const db = () => admin.firestore();
const collection = () => db().collection("written_result_exposures");

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function validUid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && !/[\/\x00-\x1f]/.test(value);
}
export function writtenExposurePath(uid: string, attemptId: string) {
  return `written_result_exposures/${createHash("sha256").update(`${uid}:${attemptId}`).digest("hex")}`;
}
function adminOnly(context: functions.https.CallableContext) {
  if (!context.auth || context.auth.token.admin !== true) {
    throw new functions.https.HttpsError("permission-denied", "管理者権限が必要です。");
  }
}
function iso(value: unknown): string | null {
  return value instanceof admin.firestore.Timestamp ? value.toDate().toISOString() : null;
}

export const recordWrittenResultExposure = functions.region("us-central1")
  .runWith({ invoker: "public" })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "認証が必要です。");
    const attemptId = data?.attemptId;
    const feedbackShown = data?.feedbackShown === true;
    const modelAnswerShown = data?.modelAnswerShown === true;
    if (!validId(attemptId) || (!feedbackShown && !modelAnswerShown)) {
      throw new functions.https.HttpsError("invalid-argument", "表示記録が不正です。");
    }
    const uid = context.auth.uid;
    const attemptRef = db().doc(`users/${uid}/attempts/${attemptId}`);
    const exposureRef = db().doc(writtenExposurePath(uid, attemptId));
    await db().runTransaction(async transaction => {
      const [attempt, exposure] = await Promise.all([
        transaction.get(attemptRef), transaction.get(exposureRef),
      ]);
      if (!attempt.exists || attempt.data()?.status !== "graded" || attempt.data()?.type !== "written") {
        throw new functions.https.HttpsError("failed-precondition", "確定済み答案がありません。");
      }
      const existing = exposure.data() || {};
      const now = admin.firestore.Timestamp.now();
      transaction.set(exposureRef, {
        uid, attemptId, unitId: attempt.data()?.unitId || null,
        ...(feedbackShown && !existing.feedbackShownAt ? { feedbackShownAt: now } : {}),
        ...(modelAnswerShown && !existing.modelAnswerShownAt ? { modelAnswerShownAt: now } : {}),
        createdAt: existing.createdAt || now,
      }, { merge: true });
    });
    return { recorded: true };
  });

export const listWrittenResultExposures = functions.region("us-central1")
  .runWith({ invoker: "public" })
  .https.onCall(async (data, context) => {
    adminOnly(context);
    const pageToken = typeof data?.pageToken === "string" && /^[a-f0-9]{64}$/.test(data.pageToken)
      ? data.pageToken : null;
    let query = collection().orderBy(admin.firestore.FieldPath.documentId()).limit(100);
    if (pageToken) query = query.startAfter(pageToken);
    const snapshot = await query.get();
    return {
      records: snapshot.docs.map(doc => {
        const record = doc.data();
        return {
          uid: record.uid, attemptId: record.attemptId,
          feedbackShownAt: iso(record.feedbackShownAt),
          modelAnswerShownAt: iso(record.modelAnswerShownAt),
        };
      }),
      nextPageToken: snapshot.size === 100 ? snapshot.docs.at(-1)?.id || null : null,
    };
  });

export const acknowledgeWrittenResultExposure = functions.region("us-central1")
  .runWith({ invoker: "public" })
  .https.onCall(async (data, context) => {
    adminOnly(context);
    if (!validUid(data?.uid) || !validId(data?.attemptId)) {
      throw new functions.https.HttpsError("invalid-argument", "答案IDが不正です。");
    }
    const ref = db().doc(writtenExposurePath(data.uid, data.attemptId));
    await db().runTransaction(async transaction => {
      const doc = await transaction.get(ref);
      if (!doc.exists) return;
      const record = doc.data() || {};
      if (record.uid !== data.uid || record.attemptId !== data.attemptId
        || iso(record.feedbackShownAt) !== (data.feedbackShownAt || null)
        || iso(record.modelAnswerShownAt) !== (data.modelAnswerShownAt || null)) {
        throw new functions.https.HttpsError("failed-precondition", "表示記録が更新されたため再回収が必要です。");
      }
      transaction.delete(ref);
    });
    return { acknowledged: true };
  });
