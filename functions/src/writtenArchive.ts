import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
import { createHash } from "node:crypto";

const PREFIX = "written-archive/v1";
const BUCKET = process.env.WRITTEN_ARCHIVE_BUCKET || "math-app-26c77.firebasestorage.app";
const db = () => admin.firestore();
const bucket = () => admin.storage().bucket(BUCKET);

function adminOnly(context: functions.https.CallableContext) {
  if (!context.auth || context.auth.token.admin !== true) {
    throw new functions.https.HttpsError("permission-denied", "管理者権限が必要です。");
  }
}

function archiveKey(uid: string, attemptId: string) {
  return `${encodeURIComponent(uid)}/${encodeURIComponent(attemptId)}`;
}

export function archiveReceiptPath(uid: string, attemptId: string) {
  return `written_archive_receipts/${createHash("sha256").update(`${uid}:${attemptId}`).digest("hex")}`;
}

async function readRecord(uid: string, attemptId: string) {
  const recordPath = `${PREFIX}/records/${archiveKey(uid, attemptId)}.json`;
  const [body] = await bucket().file(recordPath).download();
  const record = JSON.parse(body.toString("utf8"));
  if (record.uid !== uid || record.attemptId !== attemptId || record.image?.path?.startsWith(`${PREFIX}/images/${archiveKey(uid, attemptId)}.`) !== true) {
    throw new functions.https.HttpsError("data-loss", "答案の識別子が一致しません。");
  }
  return { record, recordPath };
}

async function verifiedArchive(uid: string, attemptId: string) {
  const { record, recordPath } = await readRecord(uid, attemptId);
  const attempt = await db().doc(`users/${uid}/attempts/${attemptId}`).get();
  const receipt = attempt.exists ? null : await db().doc(archiveReceiptPath(uid, attemptId)).get();
  const allowed = attempt.exists
    ? attempt.data()?.status === "graded" && attempt.data()?.archive?.sha256 === record.image.sha256
    : receipt?.data()?.sha256 === record.image.sha256;
  if (!allowed) throw new functions.https.HttpsError("failed-precondition", "採点確定前の答案です。");
  return { record, recordPath, attempt };
}

export async function deleteStagedWrittenArchive(archive: { imagePath?: string; recordPath?: string } | undefined) {
  if (!archive?.imagePath?.startsWith(`${PREFIX}/images/`) || !archive?.recordPath?.startsWith(`${PREFIX}/records/`)) return;
  await Promise.all([
    bucket().file(archive.imagePath).delete({ ignoreNotFound: true }),
    bucket().file(archive.recordPath).delete({ ignoreNotFound: true }),
  ]);
}

export async function stageWrittenArchive(params: {
  uid: string;
  attemptId: string;
  imageDataUrl: string;
  unitId: string;
  unitTitle: string;
  subject: string;
  field: string;
  questionId: string;
  questionText: string;
  modelAnswer: string;
  rubric: unknown;
  submittedAt: string;
  grading: unknown;
  gradingVersion: string;
  score: number;
  attemptOrdinal: number;
  attemptGroupId: string;
  lessonSessionId?: string;
  classKey?: string;
  instructionVersion?: string;
}) {
  const match = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(params.imageDataUrl);
  if (!match) throw new functions.https.HttpsError("invalid-argument", "答案画像の形式が不正です。");
  const bytes = Buffer.from(match[3], "base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const key = archiveKey(params.uid, params.attemptId);
  const imagePath = `${PREFIX}/images/${key}.${match[2] === "jpeg" ? "jpg" : match[2]}`;
  const recordPath = `${PREFIX}/records/${key}.json`;
  const record = {
    schemaVersion: 2,
    projectId: "math-app-26c77",
    attemptId: params.attemptId,
    uid: params.uid,
    attemptPath: `users/${params.uid}/attempts/${params.attemptId}`,
    subject: params.subject,
    field: params.field,
    unitId: params.unitId,
    unitTitle: params.unitTitle,
    questionId: params.questionId,
    questionText: params.questionText,
    modelAnswer: params.modelAnswer,
    rubric: params.rubric,
    questionVersion: createHash("sha256").update(JSON.stringify([params.questionText, params.modelAnswer])).digest("hex"),
    rubricVersion: createHash("sha256").update(JSON.stringify(params.rubric)).digest("hex"),
    gradingVersion: params.gradingVersion,
    lesson: {
      lessonSessionId: params.lessonSessionId || null,
      classKey: params.classKey || null,
      instructionVersion: params.instructionVersion || null,
    },
    submittedAt: params.submittedAt,
    score: params.score,
    attemptOrdinal: params.attemptOrdinal,
    attemptGroupId: params.attemptGroupId,
    grading: params.grading,
    image: { path: imagePath, contentType: match[1], bytes: bytes.length, sha256 },
  };
  await bucket().file(imagePath).save(bytes, { contentType: match[1], resumable: false });
  await bucket().file(recordPath).save(JSON.stringify(record), {
    contentType: "application/json", resumable: false,
  });
  return { imagePath, recordPath, sha256 };
}

export const listWrittenArchiveRecords = functions.region("us-central1")
  .runWith({ invoker: "public" })
  .https.onCall(async (data, context) => {
    adminOnly(context);
    const pageToken = typeof data?.pageToken === "string" ? data.pageToken : undefined;
    const [files, nextQuery] = await bucket().getFiles({
      prefix: `${PREFIX}/records/`, maxResults: 20, autoPaginate: false, pageToken,
    });
    const candidates = await Promise.all(files.map(async (file) => {
      const [body] = await file.download();
      const record = JSON.parse(body.toString("utf8"));
      const attempt = await db().doc(record.attemptPath).get();
      const receipt = attempt.exists ? null : await db().doc(archiveReceiptPath(record.uid, record.attemptId)).get();
      const allowed = attempt.exists
        ? attempt.data()?.status === "graded" && attempt.data()?.archive?.sha256 === record.image?.sha256
        : receipt?.data()?.sha256 === record.image?.sha256;
      return allowed ? record : null;
    }));
    const records = candidates.filter((record) => record !== null);
    return { records, nextPageToken: nextQuery?.pageToken || null };
  });

export const getWrittenArchiveImage = functions.region("us-central1")
  .runWith({ memory: "512MB", invoker: "public" })
  .https.onCall(async (data, context) => {
    adminOnly(context);
    const uid = String(data?.uid || "");
    const attemptId = String(data?.attemptId || "");
    if (!uid || !attemptId || uid.includes("/") || attemptId.includes("/")) {
      throw new functions.https.HttpsError("invalid-argument", "答案IDが不正です。");
    }
    const { record } = await verifiedArchive(uid, attemptId);
    const [bytes] = await bucket().file(record.image.path).download();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== record.image.sha256) throw new functions.https.HttpsError("data-loss", "画像の検証に失敗しました。");
    return { base64: bytes.toString("base64"), sha256 };
  });

export const acknowledgeWrittenArchive = functions.region("us-central1")
  .runWith({ invoker: "public" })
  .https.onCall(async (data, context) => {
    adminOnly(context);
    const uid = String(data?.uid || "");
    const attemptId = String(data?.attemptId || "");
    const sha256 = String(data?.sha256 || "");
    if (!uid || !attemptId || uid.includes("/") || attemptId.includes("/") || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new functions.https.HttpsError("invalid-argument", "回収確認が不正です。");
    }
    const { record, recordPath, attempt } = await verifiedArchive(uid, attemptId);
    if (record.image.sha256 !== sha256) {
      throw new functions.https.HttpsError("failed-precondition", "答案の照合に失敗しました。");
    }
    await bucket().file(record.image.path).delete({ ignoreNotFound: true });
    await bucket().file(recordPath).delete({ ignoreNotFound: true });
    await db().doc(archiveReceiptPath(uid, attemptId)).delete();
    if (attempt.exists && !attempt.data()?.archive?.downloadedAt) {
      await attempt.ref.update({ "archive.downloadedAt": admin.firestore.FieldValue.serverTimestamp() });
    }
    return { acknowledged: true };
  });
