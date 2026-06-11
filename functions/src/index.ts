import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { Timestamp, FieldValue, FieldPath } from "firebase-admin/firestore";
import { extractJsonObject } from "./writtenGradingJson";

admin.initializeApp({
  databaseURL: "https://math-app-26c77-default-rtdb.asia-southeast1.firebasedatabase.app",
});

const db = admin.firestore();
const auth = admin.auth();
const realtimeDb = admin.database();
const STANDARD_XP_QUESTION_COUNT = 10;
const BATTLE_QUESTION_COUNT = 10;
const BATTLE_BASE_SCORE = 100;
const BATTLE_ANSWER_LIMIT_MS = 30000;
const BATTLE_MAX_SPEED_BONUS = 15;
const BATTLE_FAST_BONUS_MS = 3000;
const KANJI_BATTLE_FINALIZE_TIMEOUT_MS = 90000;
const MATH_MAX_LEVEL = 100;
const MATH_LEVEL_XP_CAP_LEVEL = 40;
const BATTLE_XP_TABLE: Record<number, number[]> = {
  2: [100, -20],
  3: [125, 0, -20],
  4: [150, 75, -20, -40],
};

const KANJI_BATTLE_LEADERBOARD_LIMIT = 40;

type DrillMode = "standard" | "wrong" | "all";
type WrittenRubricScore = {
  criterionIndex: number;
  label: string;
  description: string;
  score: number;
  maxScore: number;
  comment: string;
};

type WrittenRubricCriterion = {
  criterionIndex: number;
  label: string;
  description: string;
  maxScore: number;
};

function calculateMathXpForNextLevel(level: number): number {
  const cappedLevel = Math.min(level, MATH_LEVEL_XP_CAP_LEVEL);
  return Math.floor(2.2 * Math.pow(cappedLevel, 2)) + 50;
}

type AttemptSubmittedQuestionResult = {
  questionId: string;
  questionOrder: number;
  isCorrect: boolean;
};

function clampString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function buildLogicalDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function safeAnalyticsEventIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) || "unknown";
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isSchoolEmail(email: string): boolean {
  return normalizeEmail(email).endsWith("@shibaurafzk.com");
}

function hasAppAccess(context: functions.https.CallableContext): boolean {
  if (!context.auth) return false;
  const token = context.auth.token || {};
  const email = normalizeEmail(token.email);
  return token.admin === true || token.appAccess === true || isSchoolEmail(email);
}

function assertAppAccess(context: functions.https.CallableContext): void {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication is required.");
  }
  if (!hasAppAccess(context)) {
    throw new functions.https.HttpsError("permission-denied", "This account is not allowed to use this service.");
  }
}

function isMathWrittenUnit(unitData: any): boolean {
  if (unitData?.drillType !== "written") return false;
  const subject = String(unitData?.subject || "").toLowerCase();
  const baseSubject = String(unitData?.baseSubject || "").toLowerCase();
  const subjectText = `${subject} ${baseSubject}`;
  return subjectText.includes("math") || subjectText.includes("数学");
}

function calculateServerScore(correctCount: number, totalAnswered: number, mode: DrillMode): number {
  if (mode === "all") {
    return totalAnswered > 0 ? Math.min(100, Math.round((correctCount / totalAnswered) * 100)) : 0;
  }

  return Math.min(100, correctCount * 10);
}

function clampScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function calculateWrittenXp(score: number, maxWrittenXp = 232): number {
  return Math.floor(maxWrittenXp * (clampScore(score) / 100));
}

function parseOptionalDate(value: any): Date | null {
  if (!value) return null;
  if (value?.toDate?.()) return value.toDate();
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function calculateLevelAndProgressServer(totalXp: number) {
  let level = 1;
  let accumulatedXp = 0;
  while (level < MATH_MAX_LEVEL) {
    const xpForNext = calculateMathXpForNextLevel(level);
    if (totalXp >= accumulatedXp + xpForNext) {
      accumulatedXp += xpForNext;
      level++;
    } else {
      const xpIntoCurrentLevel = totalXp - accumulatedXp;
      const progressPercent = Math.min(100, Math.max(0, (xpIntoCurrentLevel / xpForNext) * 100));
      return { level, currentLevelXp: xpIntoCurrentLevel, nextLevelXp: xpForNext, progressPercent };
    }
  }
  return { level: MATH_MAX_LEVEL, currentLevelXp: 0, nextLevelXp: 0, progressPercent: 100 };
}

function getTitleForLevelServer(level: number): string {
  if (level >= 100) return "Grandmaster";
  if (level >= 90) return "次世代のオイラー";
  if (level >= 80) return "数学の覇者";
  if (level >= 70) return "数学マスター";
  if (level >= 60) return "数学の賢者";
  if (level >= 50) return "芝浦の数理ハンター";
  if (level >= 40) return "数学のひらめき";
  if (level >= 30) return "論理の探求者";
  if (level >= 20) return "計算の達人";
  if (level >= 10) return "数学ビギナー";
  return "計算卒業生";
}

function clampBattleResponseMs(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return BATTLE_ANSWER_LIMIT_MS;
  return Math.min(BATTLE_ANSWER_LIMIT_MS, Math.max(0, Math.round(numeric)));
}

function calculateBattleSpeedBonus(responseMs: number): number {
  const safeResponseMs = clampBattleResponseMs(responseMs);
  if (safeResponseMs <= BATTLE_FAST_BONUS_MS) return BATTLE_MAX_SPEED_BONUS;
  if (safeResponseMs >= BATTLE_ANSWER_LIMIT_MS) return 0;
  const ratio = (BATTLE_ANSWER_LIMIT_MS - safeResponseMs) / (BATTLE_ANSWER_LIMIT_MS - BATTLE_FAST_BONUS_MS);
  return Math.max(0, Math.round(BATTLE_MAX_SPEED_BONUS * ratio));
}

function calculateBattleQuestionScore(correct: boolean, responseMs: number): number {
  if (!correct) return 0;
  return BATTLE_BASE_SCORE + calculateBattleSpeedBonus(responseMs);
}

function getBattleXpDelta(playerCount: number, rankIndex: number): number {
  const table = BATTLE_XP_TABLE[Math.min(4, Math.max(2, playerCount))] || BATTLE_XP_TABLE[2];
  return table[rankIndex] ?? table[table.length - 1] ?? 0;
}

function applyNonNegativeBattleXp(currentXp: unknown, xpDelta: number): number {
  const numericCurrentXp = Number(currentXp);
  const safeCurrentXp = Number.isFinite(numericCurrentXp) ? Math.max(0, numericCurrentXp) : 0;
  return Math.max(0, safeCurrentXp + xpDelta);
}

function buildAttemptSubmittedAnalyticsEvent(params: {
  now: admin.firestore.Timestamp;
  attemptId: string;
  uid: string;
  unitId: string;
  unitTitle: string;
  subject: string;
  category: string;
  score: number;
  timeSec: number;
  xpGain: number;
  correctCount: number;
  answeredCount: number;
  mode: DrillMode;
  questionResults: AttemptSubmittedQuestionResult[];
}) {
  return {
    eventType: "ATTEMPT_SUBMITTED",
    eventVersion: 1,
    occurredAt: params.now,
    logicalDate: buildLogicalDate(params.now.toDate()),
    attemptId: params.attemptId,
    uid: params.uid,
    unitId: params.unitId,
    unitTitle: params.unitTitle,
    subject: params.subject,
    category: params.category,
    score: params.score,
    timeSec: params.timeSec,
    xpGain: params.xpGain,
    correctCount: params.correctCount,
    answeredCount: params.answeredCount,
    mode: params.mode,
    source: "processDrillResult",
    questionResults: params.questionResults,
  };
}

// ==========================================
// 1. setAdminClaim — 管理者権限の付与/剥奪
// ==========================================
export * from "./kanji";
export * from "./analyticsAggregation";
export * from "./cleanup";

export const setAdminClaim = functions.region("us-central1").https.onCall(async (data, context) => {
  // 呼び出し元が管理者であることを確認
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "管理者のみがこの操作を実行できます。"
    );
  }

  const { email, isAdmin } = data as { email: string; isAdmin: boolean };

  if (!email || typeof isAdmin !== "boolean") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "email (string) と isAdmin (boolean) が必要です。"
    );
  }

  // セキュリティガード: 自分自身の権限は剥奪できない
  if (email === context.auth.token.email && !isAdmin) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "自分自身の管理者権限を剥奪することはできません。他の管理者に依頼してください。"
    );
  }

  try {
    const targetUser = await auth.getUserByEmail(email);
    
    // 1. Auth Custom Claims の更新
    await auth.setCustomUserClaims(targetUser.uid, {
      ...(targetUser.customClaims || {}),
      admin: isAdmin,
    });

    // 2. Firestore ドキュメントの同期 (互換性・UI表示用)
    await db.collection("users").doc(targetUser.uid).set({
      isAdmin: isAdmin,
      updatedAt: Timestamp.now().toDate().toISOString()
    }, { merge: true });

    return { 
      success: true, 
      message: `${email} の管理者権限を ${isAdmin ? "付与" : "剥奪"} し、Firestore データを更新しました。` 
    };
  } catch (error: any) {
    throw new functions.https.HttpsError(
      "not-found",
      `ユーザー ${email} の処理中にエラーが発生しました: ${error.message}`
    );
  }
});

// ==========================================
// 2. submitFeedback — アプリ内フィードバックの受付
// ==========================================
export const setAppAccessClaim = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only admins can change app access."
    );
  }

  const email = normalizeEmail((data as any)?.email);
  const allowed = (data as any)?.allowed;
  if (!email || typeof allowed !== "boolean") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "email (string) and allowed (boolean) are required."
    );
  }

  if (isSchoolEmail(email)) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "School domain accounts are already allowed automatically."
    );
  }

  const inviteRef = db.collection("accessInvites").doc(email);
  const now = Timestamp.now();

  try {
    const targetUser = await auth.getUserByEmail(email);
    await auth.setCustomUserClaims(targetUser.uid, {
      ...(targetUser.customClaims || {}),
      appAccess: allowed,
    });

    await db.collection("users").doc(targetUser.uid).set({
      email,
      appAccess: allowed,
      accessUpdatedAt: now.toDate().toISOString(),
      accessUpdatedBy: context.auth.token.email || context.auth.uid,
    }, { merge: true });

    if (allowed) {
      await inviteRef.delete().catch(() => undefined);
    } else {
      await inviteRef.set({
        email,
        allowed: false,
        revokedAt: now,
        revokedBy: context.auth.uid,
        revokedByEmail: context.auth.token.email || "",
      }, { merge: true });
    }

    return {
      success: true,
      status: allowed ? "granted" : "revoked",
      message: `${email} app access ${allowed ? "granted" : "revoked"}.`,
    };
  } catch (error: any) {
    if (error?.code !== "auth/user-not-found") {
      throw new functions.https.HttpsError(
        "internal",
        `Failed to update app access for ${email}: ${error.message || error}`
      );
    }

    if (!allowed) {
      await inviteRef.delete().catch(() => undefined);
      return {
        success: true,
        status: "invite-deleted",
        message: `${email} pending app access invite deleted.`,
      };
    }

    await inviteRef.set({
      email,
      allowed: true,
      createdAt: now,
      createdBy: context.auth.uid,
      createdByEmail: context.auth.token.email || "",
    }, { merge: true });

    return {
      success: true,
      status: "invited",
      message: `${email} is not registered yet. A pending app access invite was saved.`,
    };
  }
});

export const claimAppAccessFromInvite = functions.region("us-central1").https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication is required.");
  }

  const email = normalizeEmail(context.auth.token.email);
  if (!email) {
    throw new functions.https.HttpsError("failed-precondition", "The signed-in account has no email.");
  }

  if (hasAppAccess(context)) {
    return { granted: true, alreadyAllowed: true };
  }

  const inviteRef = db.collection("accessInvites").doc(email);
  const inviteSnap = await inviteRef.get();
  const invite = inviteSnap.data();
  if (!inviteSnap.exists || invite?.allowed !== true) {
    return { granted: false };
  }

  const userRecord = await auth.getUser(context.auth.uid);
  await auth.setCustomUserClaims(context.auth.uid, {
    ...(userRecord.customClaims || {}),
    appAccess: true,
  });

  const now = Timestamp.now();
  await db.collection("users").doc(context.auth.uid).set({
    uid: context.auth.uid,
    email,
    displayName: context.auth.token.name || "",
    appAccess: true,
    accessUpdatedAt: now.toDate().toISOString(),
    accessUpdatedBy: "invite",
  }, { merge: true });

  await inviteRef.set({
    claimedAt: now,
    claimedBy: context.auth.uid,
    allowed: false,
  }, { merge: true });

  return { granted: true };
});

export const submitFeedback = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "認証が必要です。");
  }

  const message = clampString((data as any)?.message, 1000);
  const pagePath = clampString((data as any)?.pagePath, 200) || "/";
  const userAgent = clampString((data as any)?.userAgent, 300);

  if (message.length < 2) {
    throw new functions.https.HttpsError("invalid-argument", "フィードバック本文を入力してください。");
  }

  const now = Timestamp.now();
  await db.collection("user_feedback").add({
    message,
    pagePath,
    userAgent,
    source: "formix",
    status: "new",
    uid: context.auth.uid,
    userName: context.auth.token?.name || "",
    userEmail: context.auth.token?.email || "",
    createdAt: now,
    updatedAt: now,
  });

  return { success: true };
});

// ==========================================
// 3. processDrillResult — 演習結果の統合処理
// ==========================================
// 選択肢をパース（Firestore の options フィールドが文字列の場合も対応）
export const submitWrittenGradingFeedback = functions
  .region("us-central1")
  .runWith({ invoker: "public" })
  .https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "認証が必要です。");
  }

  const payload = data as any;
  const unitId = clampString(payload?.unitId, 120);
  const attemptId = clampString(payload?.attemptId, 120);
  const questionId = clampString(payload?.questionId, 120);
  const unitTitle = clampString(payload?.unitTitle, 200);
  const questionText = clampString(payload?.questionText, 1000);
  const message = clampString(payload?.message, 1000);
  const score = clampScore(payload?.score);
  const rating = clampString(payload?.rating, 40);
  const strictness = clampString(payload?.strictness, 40);
  const usefulness = clampString(payload?.usefulness, 40);
  const clarity = clampString(payload?.clarity, 40);
  const allowedRatings = new Set(["helpful", "partly_helpful", "not_helpful"]);
  const allowedStrictness = new Set(["too_lenient", "appropriate", "too_strict", "unsure"]);
  const allowedUsefulness = new Set(["very_useful", "somewhat_useful", "not_useful"]);
  const allowedClarity = new Set(["clear", "somewhat_unclear", "unclear"]);

  if (!unitId || !attemptId || !questionId) {
    throw new functions.https.HttpsError("invalid-argument", "必要な情報が不足しています。");
  }
  if (!allowedRatings.has(rating) || !allowedStrictness.has(strictness) || !allowedUsefulness.has(usefulness) || !allowedClarity.has(clarity)) {
    throw new functions.https.HttpsError("invalid-argument", "フィードバック項目が不正です。");
  }

  const uid = context.auth.uid;
  const attemptRef = db.doc(`users/${uid}/attempts/${attemptId}`);
  const attemptSnap = await attemptRef.get();
  if (!attemptSnap.exists || attemptSnap.data()?.type !== "written" || attemptSnap.data()?.unitId !== unitId) {
    throw new functions.https.HttpsError("permission-denied", "対象の記述式結果が確認できません。");
  }

  const now = Timestamp.now();
  await db.collection("written_grading_feedback").add({
    feedbackType: "written_grading",
    status: "new",
    uid,
    userName: context.auth.token?.name || "",
    userEmail: context.auth.token?.email || "",
    unitId,
    unitTitle,
    questionId,
    questionText,
    attemptId,
    score,
    rating,
    strictness,
    usefulness,
    clarity,
    message,
    rubricScores: Array.isArray(payload?.rubricScores) ? payload.rubricScores.slice(0, 10).map((item: any) => ({
      label: clampString(item?.label, 80),
      score: clampScore(item?.score),
      maxScore: Math.max(0, Math.min(100, Math.round(Number(item?.maxScore) || 0))),
    })) : [],
    source: "written_result",
    createdAt: now,
    updatedAt: now,
  });

  return { success: true };
  });

function parseOptionsServer(options: any): string[] {
  if (Array.isArray(options)) return options.map(String);
  if (typeof options === "string") {
    try {
      const parsed = JSON.parse(options);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return options.trim() ? options.split(",").map((s: string) => s.trim()) : [];
    }
  }
  return [];
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function getKanjiQuestionAnswer(question: any): string {
  if (typeof question.answer === "string" && question.answer.trim()) {
    return question.answer.trim();
  }
  const parsedOptions = parseOptionsServer(question.options);
  const answerIndex = Number(question.answer_index) - 1;
  if (Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < parsedOptions.length) {
    return parsedOptions[answerIndex] || "";
  }
  return "";
}

function sortQuestionsServer(questions: any[]): any[] {
  return [...questions].sort((a, b) => {
    const aOrder = Number(a?.order);
    const bOrder = Number(b?.order);
    const aHasOrder = Number.isFinite(aOrder);
    const bHasOrder = Number.isFinite(bOrder);
    if (aHasOrder && bHasOrder && aOrder !== bOrder) return aOrder - bOrder;
    if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
    return String(a?.id || "").localeCompare(String(b?.id || ""), "ja", { numeric: true });
  });
}

function seededRandom(seed: string): () => number {
  let state = hashString(seed) || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function seededFisherYatesShuffle<T>(items: T[], seed: string): T[] {
  const shuffled = [...items];
  const random = seededRandom(seed);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function selectKanjiBattleQuestions(unitQuestions: any[], roomId: string): any[] {
  return seededFisherYatesShuffle(unitQuestions, `kanji-battle:${roomId}`).slice(0, BATTLE_QUESTION_COUNT);
}

async function loadUnitQuestions(unitId: string, unitData: any): Promise<any[]> {
  const embeddedQuestions = Array.isArray(unitData.questions) ? unitData.questions : [];
  if (embeddedQuestions.length > 0) return sortQuestionsServer(embeddedQuestions);

  const qSnap = await db.collection(`units/${unitId}/questions`).get();
  return sortQuestionsServer(qSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
}

function buildKanjiBattleOptions(question: any, allQuestions: any[], roomId: string): { options: string[]; answerIndex: number } {
  const correctAnswer = getKanjiQuestionAnswer(question);
  const distractors = uniqueStrings([
    ...parseOptionsServer(question.options),
    ...allQuestions.map(getKanjiQuestionAnswer),
  ]).filter((option) => option !== correctAnswer);
  const options = uniqueStrings([correctAnswer, ...distractors]).slice(0, 4);
  const sortedOptions = options.sort((a, b) =>
    hashString(`${roomId}:${question.id}:${a}`) - hashString(`${roomId}:${question.id}:${b}`)
  );
  return {
    options: sortedOptions,
    answerIndex: sortedOptions.indexOf(correctAnswer),
  };
}

async function assertKanjiBattleAccess(uid: string) {
  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  if (userData.kanjiAccessBlocked === true || userData.kanjiAccessGranted !== true) {
    throw new functions.https.HttpsError("permission-denied", "Kanji mode access is required.");
  }
}

function isKanjiUnit(unitData: any): boolean {
  return unitData.subject === "kanji" || unitData.subject === "漢字" || unitData.baseSubject === "漢字";
}

export const getBattleQuestions = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication is required.");
  }
  const callerUid = context.auth.uid;

  const roomId = clampString((data as any)?.roomId, 12);
  if (!/^\d{4,8}$/.test(roomId)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid room id.");
  }

  const roomSnap = await realtimeDb.ref(`battleRooms/${roomId}`).get();
  if (!roomSnap.exists()) {
    throw new functions.https.HttpsError("not-found", "Battle room was not found.");
  }

  const room = roomSnap.val() || {};
  if (!room.participants?.[context.auth.uid]) {
    throw new functions.https.HttpsError("permission-denied", "Only room participants can load battle questions.");
  }

  const unitId = clampString(room.unitId, 120);
  if (!unitId) {
    throw new functions.https.HttpsError("failed-precondition", "Battle room has no unit id.");
  }

  const unitDoc = await db.doc(`units/${unitId}`).get();
  if (!unitDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Battle unit was not found.");
  }

  const unitData = unitDoc.data() || {};
  const unitQuestions = await loadUnitQuestions(unitId, unitData);

  const questions = unitQuestions.slice(0, BATTLE_QUESTION_COUNT).map((question) => ({
    id: String(question.id),
    question_text: String(question.question_text || ""),
    options: parseOptionsServer(question.options),
    image_url: question.image_url || null,
  }));

  if (questions.length < BATTLE_QUESTION_COUNT) {
    throw new functions.https.HttpsError("failed-precondition", "Battle unit does not have enough questions.");
  }

  return { questions };
});

export const finalizeBattleRoom = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication is required.");
  }
  const callerUid = context.auth.uid;

  const roomId = clampString((data as any)?.roomId, 12);
  if (!/^\d{4,8}$/.test(roomId)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid room id.");
  }

  const roomRef = realtimeDb.ref(`battleRooms/${roomId}`);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists()) {
    throw new functions.https.HttpsError("not-found", "Battle room was not found.");
  }

  const room = roomSnap.val() || {};
  if (!room.participants?.[callerUid]) {
    throw new functions.https.HttpsError("permission-denied", "Only room participants can finalize this battle.");
  }
  if (room.status !== "completed") {
    throw new functions.https.HttpsError("failed-precondition", "Battle is not completed yet.");
  }
  if (room.finalizedAt && room.results) {
    return { success: true, alreadyFinalized: true };
  }

  const unitId = clampString(room.unitId, 120);
  if (!unitId) {
    throw new functions.https.HttpsError("failed-precondition", "Battle room has no unit id.");
  }

  const participants = Object.values(room.participants || {}) as Array<{ uid?: string; name?: string; abandoned?: boolean }>;
  const validParticipants = participants
    .filter((participant) => participant.uid)
    .slice(0, 4)
    .map((participant) => ({
      uid: String(participant.uid),
      name: clampString(participant.name, 80) || "Player",
      abandoned: participant.abandoned === true,
    }));

  if (validParticipants.length < 2) {
    await roomRef.update({
      status: "cancelled",
      phase: "completed",
      cancellationReason: "not-enough-participants",
      cancelledAt: admin.database.ServerValue.TIMESTAMP,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    });
    return { success: true, cancelled: true, reason: "not-enough-participants" };
  }

  if (validParticipants.length > 4) {
    throw new functions.https.HttpsError("failed-precondition", "Battle requires up to 4 participants.");
  }

  const unitDoc = await db.doc(`units/${unitId}`).get();
  if (!unitDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Battle unit was not found.");
  }

  const unitData = unitDoc.data() || {};
  const unitQuestions = await loadUnitQuestions(unitId, unitData);

  const selectedQuestions = unitQuestions.slice(0, BATTLE_QUESTION_COUNT).map((question) => ({
    id: String(question.id),
    parsedOptions: parseOptionsServer(question.options),
    answerIndex: Number(question.answer_index) - 1,
  }));

  if (selectedQuestions.length < BATTLE_QUESTION_COUNT) {
    throw new functions.https.HttpsError("failed-precondition", "Battle unit does not have enough questions.");
  }

  const questionAnswers = room.questionAnswers || {};
  const resultEntries = validParticipants.map((participant) => {
    if (participant.abandoned) {
      return {
        uid: participant.uid,
        name: participant.name,
        totalScore: 0,
        correctCount: 0,
        totalQuestions: selectedQuestions.length,
        totalTimeMs: BATTLE_ANSWER_LIMIT_MS * selectedQuestions.length,
        abandoned: true,
        finishedAt: admin.database.ServerValue.TIMESTAMP,
      };
    }

    let totalScore = 0;
    let correctCount = 0;
    let totalTimeMs = 0;

    selectedQuestions.forEach((question, questionIndex) => {
      const answer = questionAnswers[String(questionIndex)]?.[participant.uid] || null;
      const responseMs = clampBattleResponseMs(answer?.responseMs);
      const selectedIndex = answer?.selectedIndex === null || answer?.selectedIndex === undefined
        ? null
        : Number(answer.selectedIndex);
      const isCorrect = selectedIndex !== null
        && Number.isInteger(selectedIndex)
        && selectedIndex === question.answerIndex
        && selectedIndex >= 0
        && selectedIndex < question.parsedOptions.length;

      totalTimeMs += responseMs;
      if (isCorrect) correctCount += 1;
      totalScore += calculateBattleQuestionScore(isCorrect, responseMs);
    });

    return {
      uid: participant.uid,
      name: participant.name,
      totalScore,
      correctCount,
      totalQuestions: selectedQuestions.length,
      totalTimeMs,
      abandoned: false,
      finishedAt: admin.database.ServerValue.TIMESTAMP,
    };
  }).sort((a, b) => {
    if (a.abandoned !== b.abandoned) return a.abandoned ? 1 : -1;
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (a.totalTimeMs !== b.totalTimeMs) return a.totalTimeMs - b.totalTimeMs;
    return a.uid.localeCompare(b.uid);
  });

  const results: Record<string, any> = {};
  resultEntries.forEach((entry, index) => {
    const rankIndex = entry.abandoned ? validParticipants.length - 1 : index;
    results[entry.uid] = {
      ...entry,
      rank: entry.abandoned ? validParticipants.length : index + 1,
      xpDelta: getBattleXpDelta(validParticipants.length, rankIndex),
    };
  });

  const finalizeResult = await db.runTransaction(async (transaction) => {
    const markerRef = db.collection("battle_results").doc(roomId);
    const markerSnap = await transaction.get(markerRef);
    if (markerSnap.exists) {
      const markerData = markerSnap.data() || {};
      return {
        alreadyFinalized: true,
        results: markerData.results || results,
        finalizedAt: markerData.finalizedAt || Timestamp.now(),
      };
    }

    const now = Timestamp.now();
    const userSnapshots = await Promise.all(
      resultEntries.map((entry) => transaction.get(db.doc(`users/${entry.uid}`)))
    );
    resultEntries.forEach((entry, index) => {
      const rankIndex = entry.abandoned ? validParticipants.length - 1 : index;
      const xpDelta = getBattleXpDelta(validParticipants.length, rankIndex);
      const userRef = db.doc(`users/${entry.uid}`);
      const userData = userSnapshots[index].exists ? userSnapshots[index].data() || {} : {};
      const currentStats = userData.battleStats || {};
      transaction.set(userRef, {
        battleStats: {
          xp: applyNonNegativeBattleXp(currentStats.xp, xpDelta),
          wins: FieldValue.increment(index === 0 ? 1 : 0),
          totalBattles: FieldValue.increment(1),
          lastBattleAt: now,
        },
      }, { merge: true });
    });
    transaction.set(markerRef, {
      roomId,
      unitId,
      hostUid: room.hostUid,
      playerCount: validParticipants.length,
      results,
      finalizedAt: now,
      finalizedBy: callerUid,
    });
    return {
      alreadyFinalized: false,
      results,
      finalizedAt: now,
    };
  });

  await roomRef.update({
    results: finalizeResult.results,
    finalizedAt: admin.database.ServerValue.TIMESTAMP,
    finalizedBy: callerUid,
  });

  return { success: true, alreadyFinalized: finalizeResult.alreadyFinalized, playerCount: validParticipants.length };
});

export const getKanjiBattleQuestions = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication is required.");
  }
  const callerUid = context.auth.uid;
  await assertKanjiBattleAccess(callerUid);

  const roomId = clampString((data as any)?.roomId, 12);
  if (!/^\d{4,8}$/.test(roomId)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid room id.");
  }

  const roomSnap = await realtimeDb.ref(`kanjiBattleRooms/${roomId}`).get();
  if (!roomSnap.exists()) {
    throw new functions.https.HttpsError("not-found", "Kanji battle room was not found.");
  }

  const room = roomSnap.val() || {};
  if (!room.participants?.[callerUid]) {
    throw new functions.https.HttpsError("permission-denied", "Only room participants can load battle questions.");
  }

  const unitId = clampString(room.unitId, 120);
  if (!unitId) {
    throw new functions.https.HttpsError("failed-precondition", "Battle room has no unit id.");
  }

  const unitDoc = await db.doc(`units/${unitId}`).get();
  if (!unitDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Battle unit was not found.");
  }

  const unitData = unitDoc.data() || {};
  if (!isKanjiUnit(unitData)) {
    throw new functions.https.HttpsError("failed-precondition", "This unit is not available in kanji battle mode.");
  }

  const unitQuestions = await loadUnitQuestions(unitId, unitData);
  const selectedQuestions = selectKanjiBattleQuestions(unitQuestions, roomId);

  if (selectedQuestions.length < BATTLE_QUESTION_COUNT) {
    throw new functions.https.HttpsError("failed-precondition", "Kanji battle unit does not have enough questions.");
  }

  // 正解（answer/answer_index）はクライアントに送らない。問題文・画像・文字数のみ返す
  const { normalizeKanjiText } = require("./kanjiOcrCore");
  const includeAnswerForAdmin = context.auth.token?.admin === true;
  const questions = selectedQuestions.map((question) => {
    let resolvedAnswer = "";
    if (question.answer_index !== undefined && Array.isArray(question.options)) {
      resolvedAnswer = (question.options as string[])[Number(question.answer_index) - 1] || "";
    } else if (typeof question.answer === "string") {
      resolvedAnswer = question.answer;
    }
    const normalized = normalizeKanjiText(resolvedAnswer);
    const expectedCharCount = Math.max(1, Array.from(normalized).length || 1);
    return {
      id: String(question.id),
      question_text: String(question.question_text || ""),
      image_url: question.image_url || null,
      expectedCharCount,
      ...(includeAnswerForAdmin ? { answer: resolvedAnswer } : {}),
    };
  });

  return { questions };
});

// ==========================================
// submitKanjiBattleOcr — 漢字対戦の手書き画像をOCR採点してRTDBに書き込む
// 通常演習の recognizeKanjiBatch と同一の OCR ロジックを kanjiOcrCore 経由で使用する
// ==========================================
export const submitKanjiBattleOcr = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Authentication is required.");
    }
    const callerUid = context.auth.uid;
    await assertKanjiBattleAccess(callerUid);

    const { roomId: rawRoomId, composedImageBase64, layout, questionIds } = data as {
      roomId: string;
      composedImageBase64: string;
      layout: import("./kanjiOcrCore").OcrQuestionLayout[];
      questionIds: string[];
    };

    const roomId = clampString(rawRoomId, 12);
    if (!/^\d{4,8}$/.test(roomId)) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid room id.");
    }
    if (!composedImageBase64 || !Array.isArray(layout) || !Array.isArray(questionIds)) {
      throw new functions.https.HttpsError("invalid-argument", "composedImageBase64, layout, questionIds are required.");
    }

    // 1. ルーム確認
    const roomSnap = await realtimeDb.ref(`kanjiBattleRooms/${roomId}`).get();
    if (!roomSnap.exists()) {
      throw new functions.https.HttpsError("not-found", "Kanji battle room was not found.");
    }
    const room = roomSnap.val() || {};
    if (!room.participants?.[callerUid]) {
      throw new functions.https.HttpsError("permission-denied", "Only room participants can submit OCR.");
    }
    if (room.status !== "completed") {
      throw new functions.https.HttpsError("failed-precondition", "Battle is not completed yet.");
    }

    // 2. べき等チェック（同じルーム・ユーザーで二重送信しない）
    const idempotencyRef = db.doc(`kanji_battle_ocr/${roomId}_${callerUid}`);
    const idempotencySnap = await idempotencyRef.get();
    if (idempotencySnap.exists) {
      return { success: true, alreadySubmitted: true };
    }

    // 3. 単元の問題データ取得（正解情報はサーバーのみ保持）
    const unitId = clampString(room.unitId, 120);
    if (!unitId) {
      throw new functions.https.HttpsError("failed-precondition", "Battle room has no unit id.");
    }
    const unitDoc = await db.doc(`units/${unitId}`).get();
    if (!unitDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Battle unit was not found.");
    }
    const unitData = unitDoc.data() || {};
    const unitQuestions = await loadUnitQuestions(unitId, unitData);
    const battleQuestions = selectKanjiBattleQuestions(unitQuestions, roomId);

    // questionIds の検証（クライアント送信値が正しいルームの問題と一致するか）
    const expectedQuestionIds = battleQuestions.map((q) => String(q.id));
    const submittedQuestionIds = questionIds.map((id) => String(id));
    if (
      submittedQuestionIds.length !== expectedQuestionIds.length ||
      !submittedQuestionIds.every((id, index) => id === expectedQuestionIds[index])
    ) {
      throw new functions.https.HttpsError("invalid-argument", "questionIds do not match the battle unit.");
    }
    const questionMap = new Map(battleQuestions.map((q) => [String(q.id), q]));
    const orderedQuestions = submittedQuestionIds
      .map((id) => questionMap.get(String(id)))
      .filter(Boolean) as typeof battleQuestions;

    // 4. Vision API 呼び出し（recognizeKanjiBatch と同一の設定）
    const visionClient = new (require("@google-cloud/vision").ImageAnnotatorClient)();
    const base64Data = composedImageBase64.replace(/^data:image\/\w+;base64,/, "");
    let visionResult: any;
    try {
      const [result] = await visionClient.documentTextDetection({
        image: { content: base64Data },
        imageContext: { languageHints: ["ja"] },
      });
      visionResult = result;
    } catch (e: any) {
      console.error("Vision API Error (battle OCR):", e);
      throw new functions.https.HttpsError("internal", "画像認識処理中にエラーが発生しました。");
    }

    // 5. 文字抽出 → 正誤判定（kanjiOcrCore の共通関数を使用）
    const {
      extractRecognizedCharacters,
      processKanjiOcrResult,
    } = require("./kanjiOcrCore");

    const recognizedCharacters = extractRecognizedCharacters(visionResult);
    const ocrResults: import("./kanjiOcrCore").KanjiOcrQuestionResult[] =
      processKanjiOcrResult(recognizedCharacters, orderedQuestions, layout);

    // 6. 問題ごとのresponseMs をRTDBから読む（クライアント送信値は信頼しない）
    const responseMsPromises = questionIds.map((_, qi) =>
      realtimeDb.ref(`kanjiBattleRooms/${roomId}/questionAnswers/${qi}/${callerUid}/responseMs`).get()
    );
    const responseMsSnaps = await Promise.all(responseMsPromises);
    const responseMsMap: number[] = responseMsSnaps.map((snap) =>
      clampBattleResponseMs(snap.exists() ? snap.val() : null)
    );

    // 7. 問題ごとのスコア計算
    let totalScore = 0;
    let correctCount = 0;
    let totalTimeMs = 0;
    const questionResults = ocrResults.map((result, qi) => {
      const responseMs = responseMsMap[qi] ?? BATTLE_ANSWER_LIMIT_MS;
      const baseScore = result.isCorrect ? BATTLE_BASE_SCORE : 0;
      const speedBonus = result.isCorrect ? calculateBattleSpeedBonus(responseMs) : 0;
      const questionScore = baseScore + speedBonus;

      totalScore += questionScore;
      if (result.isCorrect) correctCount += 1;
      totalTimeMs += responseMs;

      return {
        questionId: result.questionId,
        questionText: String(orderedQuestions[qi]?.question_text || ""),
        recognizedText: result.recognizedText,
        correctText: result.correctText,
        isCorrect: result.isCorrect,
        responseMs,
        baseScore,
        speedBonus,
        questionScore,
      };
    });

    // 8. RTDB の playerScores に書き込む
    await realtimeDb.ref(`kanjiBattleRooms/${roomId}/playerScores/${callerUid}`).set({
      score: totalScore,
      correctCount,
      totalQuestions: BATTLE_QUESTION_COUNT,
      totalTimeMs,
      questionResults,
      submittedAt: admin.database.ServerValue.TIMESTAMP,
    });

    // 9. べき等マーカーを Firestore に書き込む
    await idempotencyRef.set({
      roomId,
      uid: callerUid,
      score: totalScore,
      correctCount,
      submittedAt: Timestamp.now(),
    });

    return { success: true, alreadySubmitted: false };
  });

// ==========================================
// finalizeKanjiBattleRoom — playerScores を集計して結果・XP を確定する
// ==========================================
export const finalizeKanjiBattleRoom = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication is required.");
  }
  const callerUid = context.auth.uid;
  await assertKanjiBattleAccess(callerUid);

  const roomId = clampString((data as any)?.roomId, 12);
  if (!/^\d{4,8}$/.test(roomId)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid room id.");
  }

  const roomRef = realtimeDb.ref(`kanjiBattleRooms/${roomId}`);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists()) {
    throw new functions.https.HttpsError("not-found", "Kanji battle room was not found.");
  }

  const room = roomSnap.val() || {};
  if (!room.participants?.[callerUid]) {
    throw new functions.https.HttpsError("permission-denied", "Only room participants can finalize this battle.");
  }
  if (room.status !== "completed") {
    throw new functions.https.HttpsError("failed-precondition", "Battle is not completed yet.");
  }
  if (room.finalizedAt && room.results) {
    return { success: true, alreadyFinalized: true };
  }

  const unitId = clampString(room.unitId, 120);
  if (!unitId) {
    throw new functions.https.HttpsError("failed-precondition", "Battle room has no unit id.");
  }

  const participants = Object.values(room.participants || {}) as Array<{ uid?: string; name?: string; abandoned?: boolean }>;
  const validParticipants = participants
    .filter((participant) => participant.uid)
    .slice(0, 4)
    .map((participant) => ({
      uid: String(participant.uid),
      name: clampString(participant.name, 80) || "Player",
      abandoned: participant.abandoned === true,
    }));

  if (validParticipants.length < 2) {
    await roomRef.update({
      status: "cancelled",
      phase: "completed",
      cancellationReason: "not-enough-participants",
      cancelledAt: admin.database.ServerValue.TIMESTAMP,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    });
    return { success: true, cancelled: true, reason: "not-enough-participants" };
  }

  // playerScores を RTDB から読む（submitKanjiBattleOcr が書き込んだスコア）
  const playerScoresSnap = await realtimeDb.ref(`kanjiBattleRooms/${roomId}/playerScores`).get();
  const playerScores: Record<string, any> = playerScoresSnap.val() || {};
  const activeParticipantIds = validParticipants
    .filter((participant) => !participant.abandoned)
    .map((participant) => participant.uid);
  const allActivePlayersHaveScores = activeParticipantIds.every((uid) => !!playerScores[uid]);
  const completedAt = Number(room.completedAt || 0);
  const finalizeTimedOut = completedAt > 0 && Date.now() - completedAt > KANJI_BATTLE_FINALIZE_TIMEOUT_MS;

  if (!allActivePlayersHaveScores && !finalizeTimedOut) {
    throw new functions.https.HttpsError("failed-precondition", "Battle scores are not ready yet.");
  }

  const resultEntries = validParticipants.map((participant) => {
    const ps = playerScores[participant.uid];
    if (participant.abandoned || !ps) {
      return {
        uid: participant.uid,
        name: participant.name,
        totalScore: 0,
        correctCount: 0,
        totalQuestions: BATTLE_QUESTION_COUNT,
        totalTimeMs: BATTLE_ANSWER_LIMIT_MS * BATTLE_QUESTION_COUNT,
        abandoned: true,
        finishedAt: admin.database.ServerValue.TIMESTAMP,
      };
    }
    return {
      uid: participant.uid,
      name: participant.name,
      totalScore: Number(ps.score || 0),
      correctCount: Number(ps.correctCount || 0),
      totalQuestions: BATTLE_QUESTION_COUNT,
      totalTimeMs: Number(ps.totalTimeMs || 0),
      abandoned: false,
      finishedAt: admin.database.ServerValue.TIMESTAMP,
    };
  }).sort((a, b) => {
    if (a.abandoned !== b.abandoned) return a.abandoned ? 1 : -1;
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (a.totalTimeMs !== b.totalTimeMs) return a.totalTimeMs - b.totalTimeMs;
    return a.uid.localeCompare(b.uid);
  });

  const results: Record<string, any> = {};
  resultEntries.forEach((entry, index) => {
    const rankIndex = entry.abandoned ? validParticipants.length - 1 : index;
    results[entry.uid] = {
      ...entry,
      rank: entry.abandoned ? validParticipants.length : index + 1,
      xpDelta: getBattleXpDelta(validParticipants.length, rankIndex),
    };
  });

  const finalizeResult = await db.runTransaction(async (transaction) => {
    const markerRef = db.collection("kanji_battle_results").doc(roomId);
    const markerSnap = await transaction.get(markerRef);
    if (markerSnap.exists) {
      const markerData = markerSnap.data() || {};
      return {
        alreadyFinalized: true,
        results: markerData.results || results,
        finalizedAt: markerData.finalizedAt || Timestamp.now(),
      };
    }

    const now = Timestamp.now();
    const leaderboardRef = db.doc("leaderboards/kanjiBattle");
    const leaderboardSnap = await transaction.get(leaderboardRef);
    let battleRankings: any[] = leaderboardSnap.exists ? (leaderboardSnap.data()?.rankings || []) : [];
    const userSnapshots = await Promise.all(
      resultEntries.map((entry) => transaction.get(db.doc(`users/${entry.uid}`)))
    );
    resultEntries.forEach((entry, index) => {
      const rankIndex = entry.abandoned ? validParticipants.length - 1 : index;
      const xpDelta = getBattleXpDelta(validParticipants.length, rankIndex);
      const userRef = db.doc(`users/${entry.uid}`);
      const userData = userSnapshots[index].exists ? userSnapshots[index].data() || {} : {};
      const currentStats = userData.kanjiBattleStats || {};
      const nextXp = applyNonNegativeBattleXp(currentStats.xp, xpDelta);
      const nextWins = Number(currentStats.wins || currentStats.totalWins || userData.kanjiBattleWins || 0)
        + (index === 0 && !entry.abandoned ? 1 : 0);
      const nextTotalBattles = Number(currentStats.totalBattles || 0) + 1;
      const storedBadges = userData.kanjiSeasonBadges && typeof userData.kanjiSeasonBadges === "object"
        ? Object.values(userData.kanjiSeasonBadges) as any[]
        : [];
      const badges = [...storedBadges];
      if (!badges.some((badge: any) => badge?.seasonId === "season1") && (userData.kanjiSeason1Badge || userData.kanjiSeason1Certified === true)) {
        badges.push(userData.kanjiSeason1Badge || {
          seasonId: "season1",
          seasonNumber: 1,
          label: "Season 1 認証",
          badgeImageUrl: "/images/kanji-season1-badge.png",
        });
      }
      badges.sort((a: any, b: any) => Number(b.seasonNumber || 0) - Number(a.seasonNumber || 0));
      transaction.set(userRef, {
        kanjiBattleStats: {
          xp: nextXp,
          wins: FieldValue.increment(index === 0 && !entry.abandoned ? 1 : 0),
          totalBattles: FieldValue.increment(1),
          lastBattleAt: now,
        },
      }, { merge: true });

      const leaderboardEntry = {
        uid: entry.uid,
        name: entry.name || userData.displayName || userData.email || "Player",
        xp: nextXp,
        wins: nextWins,
        totalBattles: nextTotalBattles,
        icon: userData.icon || userData.kanjiIcon || "",
        badges,
        lastBattleAt: now.toDate().toISOString(),
      };
      battleRankings = [
        ...battleRankings.filter((ranking: any) => ranking.uid !== entry.uid),
        leaderboardEntry,
      ];
    });
    battleRankings.sort((a: any, b: any) => {
      if (Number(b.xp || 0) !== Number(a.xp || 0)) return Number(b.xp || 0) - Number(a.xp || 0);
      if (Number(b.wins || 0) !== Number(a.wins || 0)) return Number(b.wins || 0) - Number(a.wins || 0);
      return String(a.name || "").localeCompare(String(b.name || ""), "ja");
    });
    battleRankings = battleRankings.slice(0, KANJI_BATTLE_LEADERBOARD_LIMIT);
    transaction.set(leaderboardRef, {
      rankings: battleRankings,
      updatedAt: now.toDate().toISOString(),
    }, { merge: true });
    transaction.set(markerRef, {
      roomId,
      unitId,
      hostUid: room.hostUid,
      playerCount: validParticipants.length,
      results,
      finalizedAt: now,
      finalizedBy: callerUid,
    });
    return { alreadyFinalized: false, results, finalizedAt: now };
  });

  await roomRef.update({
    results: finalizeResult.results,
    finalizedAt: admin.database.ServerValue.TIMESTAMP,
    finalizedBy: callerUid,
  });

  return { success: true, alreadyFinalized: finalizeResult.alreadyFinalized, playerCount: validParticipants.length };
});

export const processDrillResult = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "認証が必要です。");
  }

  // ドメイン制限: フロントエンドと同じルールをサーバーでも強制
  const callerEmail = context.auth.token.email || "";
  const isAllowedDomain = callerEmail.endsWith("@shibaurafzk.com");
  const isIndividualAllowed = context.auth.token.admin === true || context.auth.token.appAccess === true;
  if (!isAllowedDomain && !isIndividualAllowed) {
    throw new functions.https.HttpsError("permission-denied", "このサービスの対象外アカウントです。");
  }

  const { attemptId, unitId: rawUnitId, time: rawTime, answers, mode: rawMode } = data as any;
  const unitId = (rawUnitId || "").trim();
  const drillMode: DrillMode = rawMode === "all" ? "all" : rawMode === "wrong" ? "wrong" : "standard";

  // time の検証: 1秒以上 86400秒以下（クライアント改ざん防止）
  const rawTimeNumber = Number(rawTime);
  const time = Math.max(1, Math.round(rawTimeNumber));
  if (!unitId || !Number.isFinite(rawTimeNumber) || rawTimeNumber < 0 || time > 86400 || !Array.isArray(answers)) {
    console.error("[processDrillResult] Missing required parameters", { unitId, rawTime, answers });
    throw new functions.https.HttpsError("invalid-argument", "必要なパラメータが不足しています。");
  }

  console.log(`[processDrillResult] Started for unitId: ${unitId}, uid: ${context.auth.uid}`);
  console.log(`[processDrillResult] Data summary: time=${time}, answers=${answers?.length}`);

  const safeAnswers: Array<{ questionId: string; selectedOptionText: string }> = answers;

  const uid = context.auth.uid;
  const userName = context.auth.token?.name || context.auth.token?.email || "名無し";
  const now = Timestamp.now();
  const dateStr = now.toDate().toISOString();

  // ==========================================
  // --- 1. サーバー側入力検証（改ざん防止）---
  // 問題ID照合・正誤判定・スコア計算・XP計算をすべてサーバーで行う
  // ==========================================

  // 1-1. 単元ドキュメント取得と問題マップの構築
  const unitDoc = await db.doc(`units/${unitId}`).get();
  if (!unitDoc.exists) {
    throw new functions.https.HttpsError("not-found", "指定された単元が見つかりません。");
  }
  const unitData = unitDoc.data()!;
  // unitTitle はサーバー側の値を使用（クライアント送信値は信頼しない）
  const unitTitle: string = unitData.title || unitId;
  const unitSubject: string = unitData.subject || "数学";
  const unitCategory: string = unitData.category || "その他";
  let unitQuestions: any[] = Array.isArray(unitData.questions) ? unitData.questions : [];
  if (unitQuestions.length === 0) {
    // 問題がサブコレクションに格納されている場合のフォールバック
    const qSnap = await db.collection(`units/${unitId}/questions`).get();
    unitQuestions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // 問題ID → 問題データ（parsedOptions 付き）のマップ
  const unitQuestionMap = new Map<string, any>();
  for (const q of unitQuestions) {
    unitQuestionMap.set(String(q.id), { ...q, parsedOptions: parseOptionsServer(q.options) });
  }

  // 1-2. 問題ID照合：送信された全問題IDが当該単元に実在するか確認
  const invalidIds = safeAnswers
    .map(a => String(a.questionId))
    .filter(id => !unitQuestionMap.has(id));
  if (invalidIds.length > 0) {
    console.warn(`[processDrillResult] Invalid question IDs from uid=${uid}:`, invalidIds);
    await db.collection("suspicious_activities").add({
      uid, userName, unitId,
      reasons: [`不正な問題ID ${invalidIds.length}件`],
      timestamp: now,
      details: { time, invalidIds },
    });
    throw new functions.https.HttpsError("invalid-argument", "不正な問題IDが含まれています。");
  }

  // 1-3. サーバー側で正誤判定・スコア計算・XP計算を実施
  const safeCorrectQuestions: any[] = [];
  const safeWrongQuestions: any[] = [];
  const answerOrderForCombo: boolean[] = [];
  const questionResultsForAnalytics: AttemptSubmittedQuestionResult[] = [];

  for (const [index, answer] of safeAnswers.entries()) {
    const q = unitQuestionMap.get(String(answer.questionId))!;
    const answerIndex = Number(q.answer_index);
    const correctOptionText = q.parsedOptions[answerIndex - 1] ?? ""; // answer_index は 1-based
    const isCorrect = String(answer.selectedOptionText) === String(correctOptionText);

    answerOrderForCombo.push(isCorrect);
    questionResultsForAnalytics.push({
      questionId: String(q.id),
      questionOrder: Number(q.order ?? index + 1),
      isCorrect,
    });

    if (isCorrect) {
      safeCorrectQuestions.push({ id: q.id, question_text: q.question_text });
    } else {
      safeWrongQuestions.push({
        id: q.id,
        question_text: q.question_text,
        selectedOptionText: answer.selectedOptionText,
        correctOptionText,
        explanation: q.explanation || "",
        options: q.parsedOptions,
      });
    }
  }

  const totalAnswered = safeAnswers.length;
  const serverScore = calculateServerScore(safeCorrectQuestions.length, totalAnswered, drillMode);

  // XP計算（正解順序によるコンボボーナスを含む）
  let baseTotal = 0;
  let comboTotal = 0;
  let currentCombo = 0;
  for (const isCorrect of answerOrderForCombo) {
    if (isCorrect) {
      currentCombo++;
      baseTotal += 10;
      comboTotal += currentCombo;
    } else {
      currentCombo = 0;
    }
  }
  const correctRatio = totalAnswered > 0 ? safeCorrectQuestions.length / totalAnswered : 0;
  let multiplier = 0;
  if (correctRatio === 1) multiplier = 1.5;
  else if (correctRatio >= 0.7) multiplier = 1.0;
  else if (correctRatio >= 0.5) multiplier = 0.5;
  // 全問モードで50問以上を解いても、XPの上限は標準の10問演習と同等に抑える。
  // base は線形、combo は連続正解が問題数の二乗で増えるため二乗スケールで正規化する。
  const questionCountFactor = totalAnswered > 0
    ? Math.min(1, STANDARD_XP_QUESTION_COUNT / totalAnswered)
    : 0;
  const normalizedBaseTotal = Math.round(baseTotal * questionCountFactor);
  const normalizedComboTotal = Math.round(comboTotal * questionCountFactor * questionCountFactor);
  const preMultiplierXp = normalizedBaseTotal + normalizedComboTotal;
  // finalXpGain・xpDetails はトランザクション内で drillCount 参照後に確定

  // alreadyProcessed 時に返すための結果オブジェクト（問題の詳細を含む）
  const questionResults = {
    score: serverScore,
    correctQuestions: safeCorrectQuestions,
    wrongQuestions: safeWrongQuestions,
  };

  try {
    // --- 2. トランザクションによるデータ更新 ---
    const result = await db.runTransaction(async (transaction) => {
    const userRef = db.doc(`users/${uid}`);
    
    // Idempotency: attemptIdを使ってすでに記録が存在するか確認
    const attemptDocId = attemptId || db.collection(`users/${uid}/attempts`).doc().id;
    const attemptRef = db.collection(`users/${uid}/attempts`).doc(attemptDocId);
    const analyticsEventRef = db.collection("analytics_events").doc(`submit_${attemptDocId}`);

    const [userSnap, attemptSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(attemptRef)
    ]);

    if (attemptSnap.exists) {
      console.log(`[processDrillResult] Attempt ${attemptDocId} is already processed. Bailing out early.`);
      return {
        success: true,
        alreadyProcessed: true,
        isHighScore: false,
        isLevelUp: false,
        xpDetails: { base: 0, combo: 0, multiplier: 0, multiplierBonus: 0, finalXp: 0 },
        _rapidSubmission: null,
        ...questionResults,
      };
    }

    // ③: lastAttemptTimes からインターバルチェック（subcollection クエリ不要・1読み取り削減）
    let _rapidSubmissionSec: number | null = null;
    const lastAttemptTimeStr: string | null = userSnap.exists
      ? (userSnap.data()?.lastAttemptTimes?.[unitId] || null)
      : null;
    if (lastAttemptTimeStr) {
      const lastDateTime = new Date(lastAttemptTimeStr).getTime();
      const diffSec = (now.toMillis() - lastDateTime) / 1000;
      if (diffSec < 30 && totalAnswered >= 10) {
        _rapidSubmissionSec = Math.round(diffSec);
        console.warn(`[processDrillResult] Rapid submission uid=${uid}: ${_rapidSubmissionSec}s`);
      }
    }

    let currentXp = 0;
    let currentIcon = "📐";
    let currentTotalScore = 0;
    if (userSnap.exists) {
      const uData = userSnap.data();
      currentXp = uData?.xp || 0;
      currentIcon = uData?.icon || "📐";
      currentTotalScore = uData?.totalScore || 0;
    }

    // 2-1. スコア更新判定 (High Score) と unitStats マージ
    // unitStats マップ全体を取得してマージ（ドット記法ではなくリテラルキーで保存するため）
    const existingUnitStats = userSnap.exists ? (userSnap.data()?.unitStats || {}) : {};
    const existingLastAttemptTimes = userSnap.exists ? (userSnap.data()?.lastAttemptTimes || {}) : {};
    const existingUnitData = existingUnitStats[unitId] || {};
    const existingMaxScore = existingUnitData.maxScore || 0;
    const existingBestTime = existingUnitData.bestTime || Infinity;

    let isHighScore = false;
    if (existingUnitData.maxScore === undefined) {
      isHighScore = true;
    } else {
      if (serverScore > existingMaxScore || (serverScore === existingMaxScore && time < existingBestTime)) {
        isHighScore = true;
      }
    }

    // 2-2. drillCount ベースの XP 逓減レート計算
    const drillCount = existingUnitData.drillCount || 0;
    const attemptNumber = drillCount + 1; // 1始まり
    let xpRateMultiplier: number;
    if (attemptNumber <= 3) xpRateMultiplier = 1.0;                          // 1〜3回目:  100%
    else if (attemptNumber <= 5) xpRateMultiplier = 0.7;                     // 4〜5回目:   70%
    else if (attemptNumber <= 10) xpRateMultiplier = 0.3;                    // 6〜10回目:  30%
    else xpRateMultiplier = multiplier === 1.5 ? 0.2 : 0.1;                 // 11回目以降: 全問正解20%, それ以外10%

    const finalXpGain = Math.floor(preMultiplierXp * multiplier * xpRateMultiplier);
    const xpDetailsResult = {
      base: normalizedBaseTotal,
      combo: normalizedComboTotal,
      multiplier,
      multiplierBonus: finalXpGain - preMultiplierXp,
      finalXp: finalXpGain,
    };

    // 2-3. XP / レベル計算
    const newTotalXp = currentXp + finalXpGain;

    const calculateLevelAndProgress = (totalXp: number) => {
      let level = 1;
      let accumulatedXp = 0;
      while (level < MATH_MAX_LEVEL) {
        const xpForNext = calculateMathXpForNextLevel(level);
        if (totalXp >= accumulatedXp + xpForNext) {
          accumulatedXp += xpForNext;
          level++;
        } else {
          const xpIntoCurrentLevel = totalXp - accumulatedXp;
          const progressPercent = Math.min(100, Math.max(0, (xpIntoCurrentLevel / xpForNext) * 100));
          return { level, currentLevelXp: xpIntoCurrentLevel, nextLevelXp: xpForNext, progressPercent };
        }
      }
      return { level: MATH_MAX_LEVEL, currentLevelXp: 0, nextLevelXp: 0, progressPercent: 100 };
    };

    const getTitleForLevel = (level: number): string => {
      if (level >= 100) return 'Grandmaster';
      if (level >= 90) return '次世代のオイラー';
      if (level >= 80) return '数学の覇者';
      if (level >= 70) return '数学マスター';
      if (level >= 60) return '数学の賢者';
      if (level >= 50) return '芝浦の数理ハンター';
      if (level >= 40) return '数学のひらめき';
      if (level >= 30) return '論理の探求者';
      if (level >= 20) return '計算の達人';
      if (level >= 10) return '数学ビギナー';
      return '算数卒業生';
    };

    const oldLevelData = calculateLevelAndProgress(currentXp);
    const newLevelData = calculateLevelAndProgress(newTotalXp);
    const oldLevel = oldLevelData.level;
    const newLevel = newLevelData.level;
    const isLevelUp = newLevel > oldLevel;

    // --- 各種書き込み実行 ---
    
    // User Update (XP, totalScore, unitStats, level details)
    const userUpdate: any = { 
      xp: newTotalXp,
      level: newLevel,
      title: getTitleForLevel(newLevel),
      progressPercent: newLevelData.progressPercent,
      currentLevelXp: newLevelData.currentLevelXp,
      nextLevelXp: newLevelData.nextLevelXp,
      updatedAt: dateStr,
      ...(userSnap.exists && currentIcon !== "📐" ? {} : { icon: "📐" })
    };
    
    // unitStatsの構築 (scoresとwrong_answersを内包)
    // Wrong Answers List (間違えた問題のID配列を保持)
    let currentWrongs: string[] = existingUnitData.wrongQuestionIds || [];
    const newlyCorrectIds = safeCorrectQuestions.map((q: any) => q.id);
    const newlyWrongIds = safeWrongQuestions.map((q: any) => q.id);
    currentWrongs = currentWrongs.filter((id: string) => !newlyCorrectIds.includes(id));
    newlyWrongIds.forEach((id: string) => { if (!currentWrongs.includes(id)) currentWrongs.push(id); });

    // 修正: FieldPath オブジェクトを {} のキーに使うと "[object Object]" という文字列になってしまうため、
    // 複数の FieldPath を含む更新には可変引数形式 (variadic) を使用する。
    const statsPathValue = {
      maxScore: isHighScore ? serverScore : (existingUnitData.maxScore || 0),
      bestTime: isHighScore ? time : (existingUnitData.bestTime ?? null),
      wrongQuestionIds: currentWrongs,
      totalCorrect: (existingUnitData.totalCorrect || 0) + safeCorrectQuestions.length,
      drillCount: drillCount + 1,
      updatedAt: dateStr
    };

    // 2-4. totalScore の再計算 (自己修復ロジック)
    // increment を使わず、全ての単元の maxScore を合計することで不整合を防ぐ
    const updatedStatsForTotal = { ...existingUnitStats, [unitId]: statsPathValue };
    const recalculatedTotalScore = Object.values(updatedStatsForTotal).reduce((acc: number, stat: any) => {
      return acc + (stat.maxScore || 0);
    }, 0);
    userUpdate.totalScore = recalculatedTotalScore;

    // 他の基本フィールドの更新
    const baseUpdates: any = { ...userUpdate };
    delete baseUpdates.unitStats;
    delete baseUpdates.lastAttemptTimes;

    const statsPath = new FieldPath("unitStats", unitId);
    const lastAttemptPath = new FieldPath("lastAttemptTimes", unitId);

    // 修正: この SDK バージョンの Transaction.update () は引数を最大3つまでしか受け取らない
    //（docRef, data オブジェクト）または（docRef, fieldPath, value）形式。
    // そのため、複数の FieldPath を更新する場合は個別に呼び出す必要がある。
    transaction.update(userRef, baseUpdates);
    transaction.update(userRef, statsPath, statsPathValue);
    transaction.update(userRef, lastAttemptPath, dateStr);

    // Attempts (Subcollection) - トランザクション内で事前作成した attemptRef を使用
    // TTL用 expireAt: 90日後に自動削除対象
    const expireAt = new Date(now.toDate().getTime() + 90 * 24 * 60 * 60 * 1000);
    transaction.set(attemptRef, {
      uid, userName, // Admin画面でAttemptsベースの集計をするためにuid/userNameを保存
      unitId, unitTitle, score: serverScore, time, date: dateStr,
      mode: drillMode,
      xpGain: finalXpGain,
      answeredCount: totalAnswered,
      expireAt: Timestamp.fromDate(expireAt),
      details: [
        ...safeCorrectQuestions.map((q: any) => ({ qId: q.id, isCorrect: true })),
        ...safeWrongQuestions.map((q: any) => ({ qId: q.id, isCorrect: false }))
      ]
    });

    // Keep only the lightweight participant counter here. Drill/correct totals
    // are derived from analytics_events by the BigQuery aggregation pipeline.
    if (isHighScore && currentTotalScore === 0) {
      transaction.set(db.doc("stats/global"), {
        totalParticipants: FieldValue.increment(1),
        updatedAt: dateStr,
      }, { merge: true });
    }
    transaction.set(analyticsEventRef, buildAttemptSubmittedAnalyticsEvent({
      now,
      attemptId: attemptDocId,
      uid,
      unitId,
      unitTitle,
      subject: unitSubject,
      category: unitCategory,
      score: serverScore,
      timeSec: time,
      xpGain: finalXpGain,
      correctCount: safeCorrectQuestions.length,
      answeredCount: safeCorrectQuestions.length + safeWrongQuestions.length,
      mode: drillMode,
      questionResults: questionResultsForAnalytics,
    }));

    return {
      success: true,
      isHighScore,
      isLevelUp,
      oldLevel,
      newLevel,
      xpGain: finalXpGain,
      newTotalXp,
      xpDetails: xpDetailsResult,
      ...questionResults,
      // リーダーボード更新に必要な情報を返す
      // isHighScore（スコア更新）またはレベルアップ時のみ更新する。
      // XP増加のみで順位・レベルに変化がない場合は書き込みを節約するためスキップ。
      _leaderboardUpdate: (isHighScore || isLevelUp)
        ? { uid, userName, currentIcon, newLevel, newTotalXp }
        : null,
      _rapidSubmission: _rapidSubmissionSec,
    };
  });

  // --- 3. トランザクション後の非クリティカル処理 ---
  const resultAny = result as any;

  // 不審アクティビティ（短時間の連続演習）をログ記録
  if (resultAny._rapidSubmission !== null && resultAny._rapidSubmission !== undefined) {
    try {
      await db.collection("suspicious_activities").add({
        uid, userName, unitId,
        reasons: [`異常に短い演習間隔: ${resultAny._rapidSubmission}秒`],
        timestamp: now,
        details: { score: serverScore, time, correctCount: safeCorrectQuestions.length },
      });
    } catch (e) {
      console.error("[processDrillResult] Suspicious activity log error (non-critical):", e);
    }
  }

  // リーダーボード更新（isHighScore またはレベルアップ時のみ）
  if (resultAny._leaderboardUpdate) {
    try {
      await updateLeaderboard(resultAny._leaderboardUpdate);
    } catch (leaderboardErr) {
      console.error("[processDrillResult] Leaderboard update failed (non-critical):", leaderboardErr);
    }
  }

  // 内部フィールドはクライアントに返さない
  const { _leaderboardUpdate: _lb, _rapidSubmission: _rs, ...clientResult } = resultAny;
  return clientResult;

} catch (error: any) {
  console.error("[processDrillResult] Transaction failed:", error);
  console.error("[processDrillResult] Stack trace:", error.stack);
  // 内部エラー詳細はログのみ。クライアントには汎用メッセージを返す
  if (error instanceof functions.https.HttpsError) throw error;
  throw new functions.https.HttpsError("internal", "内部処理エラーが発生しました。");
}
});

function parseDataUrlImage(dataUrl: string): { mimeType: string; data: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) {
    throw new functions.https.HttpsError("invalid-argument", "解答画像の形式が不正です。");
  }
  return { mimeType: match[1], data: match[2] };
}

function parseLegacyRubricText(text: string, index: number): WrittenRubricCriterion {
  const trimmed = text.trim();
  const [head, ...tailParts] = trimmed.split(/\s+-\s+/);
  const headText = head || trimmed;
  const description = clampString(tailParts.join(" - ") || trimmed, 800);
  const scoreMatch = headText.match(/(\d+(?:\.\d+)?)\s*(?:点|pts?|points?)/i);
  const maxScore = Math.max(1, Math.min(100, Math.round(Number(scoreMatch?.[1]) || 100)));
  const label = clampString(
    headText.replace(/[:：]?\s*\d+(?:\.\d+)?\s*(?:点|pts?|points?).*$/i, "").replace(/[:：]\s*$/, ""),
    80
  ) || `評価項目${index + 1}`;

  return {
    criterionIndex: index + 1,
    label,
    description,
    maxScore,
  };
}

function normalizeWrittenRubric(value: unknown): WrittenRubricCriterion[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item: any, index: number) => {
    if (typeof item === "string") {
      return parseLegacyRubricText(item, index);
    }

    const maxScore = Math.max(1, Math.min(100, Math.round(Number(item?.maxScore ?? item?.points ?? item?.score ?? 100) || 100)));
    const label = clampString(item?.label ?? item?.name ?? item?.criterion, 80) || `評価項目${index + 1}`;
    const description = clampString(item?.description ?? item?.criterionText ?? item?.detail ?? item?.details ?? "", 800);

    return {
      criterionIndex: Math.max(1, Math.trunc(Number(item?.criterionIndex)) || index + 1),
      label,
      description,
      maxScore,
    };
  });
}

function normalizeRubricScores(value: unknown, rubricCriteria: WrittenRubricCriterion[] = []): WrittenRubricScore[] {
  if (!Array.isArray(value)) return [];
  const maxItems = rubricCriteria.length > 0 ? rubricCriteria.length : Math.min(value.length, 8);

  return Array.from({ length: maxItems }).map((_, index) => {
    const item = (value as any[])[index] || {};
    const criterion = rubricCriteria[index];
    const maxScore = criterion?.maxScore ?? Math.max(1, Math.min(100, Math.round(Number(item?.maxScore) || 100)));

    return {
      criterionIndex: criterion?.criterionIndex ?? index + 1,
      label: criterion?.label || clampString(item?.label, 80) || "評価項目",
      description: criterion?.description || clampString(item?.description ?? item?.criterionText, 800),
      score: Math.max(0, Math.min(maxScore, Math.round(Number(item?.score) || 0))),
      maxScore,
      comment: clampString(item?.comment, 500),
    };
  });
}

async function gradeWrittenAnswerWithGemini(params: {
  unitTitle: string;
  questionText: string;
  modelAnswer: string;
  gradingRubric: unknown;
  answerImageDataUrl: string;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new functions.https.HttpsError("failed-precondition", "Gemini API key is not configured.");
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const image = parseDataUrlImage(params.answerImageDataUrl);
  const rubricCriteria = normalizeWrittenRubric(params.gradingRubric);
  const prompt = [
    "You are grading a Japanese middle-school math written answer.",
    "Return only strict JSON. Do not include markdown.",
    "Score the full handwritten work, including intermediate steps, out of 100.",
    "Use the provided model answer and rubric. Grade strictly, but keep feedback concise and age-appropriate.",
    "Return rubricScores in the exact same order as the provided rubric. Each rubric score must be between 0 and that criterion's maxScore.",
    "Default scoring policy: process/reasoning is 60 points, final answer/conclusion is 40 points. Follow a more specific rubric only if it is stricter.",
    "If the final answer or required conclusion is mathematically wrong, the total score must be at most 60, even if the process is mostly correct.",
    "If the final answer is correct but there is no meaningful reasoning, setup, proof, or calculation process, the total score must be at most 40.",
    "If the final answer is correct but the reasoning is incomplete, award 40 points for the result plus only the justified part of the 60 process points.",
    "If the final answer is missing, ambiguous, or does not answer the exact question, the total score must be at most 60.",
    "If the reasoning contains a serious contradiction or invalid step that happens to lead to the right answer, the total score must be at most 50.",
    "For proof problems, treat the proved conclusion as the 40-point result component and the assumptions, logical chain, and cited reasons as the 60-point process component.",
    "For pure calculation problems, still require enough written work to identify the method unless the problem explicitly asks for answer only.",
    "For word/explanation problems, check the exact target, unit, sign, comparison direction, and what the final value refers to. Missing or wrong target/unit/sign/comparison should be penalized.",
    "For problems that require explanation, do not accept formulas alone as a complete response unless their meaning is clear from the student's written words.",
    "For variable introductions, theorem use, formulas, substitutions, and case splits, require visible definitions or reasons in the answer. Do not supply them yourself.",
    "Do not infer unstated reasoning. Grade only what is visible in the submitted answer image.",
    "Do not give full credit for a correct final answer if the reasoning is incomplete.",
    "Deduct points when variables are introduced without definition, for example using r or h without stating what they represent.",
    "Deduct points for missing units, missing conclusion sentence, unclear comparison target, skipped justification, formula misuse, algebra mistakes, or ambiguous notation.",
    "If the rubric is vague, reserve 10 to 20 points for mathematical communication: variable definitions, readable steps, and answering the exact question.",
    "Before grading, briefly transcribe the visible handwritten answer. Use the transcription only as a record of what you read from the image. If a part is unreadable, write [unclear].",
    "In feedback, improvementPoints, rubric comments, and detectedAnswer, wrap all mathematical expressions in LaTeX delimiters like \\( ... \\). Use \\times, \\div, \\frac{}, and \\pi instead of plain symbols where appropriate.",
    "",
    `Unit: ${params.unitTitle}`,
    `Question: ${params.questionText}`,
    `Model answer: ${params.modelAnswer || "Not provided"}`,
    `Rubric: ${JSON.stringify(rubricCriteria.length > 0 ? rubricCriteria : params.gradingRubric || [])}`,
    "",
    "JSON schema:",
    '{"score":number,"transcription":string,"detectedAnswer":string,"rubricScores":[{"score":number,"comment":string}],"feedback":string,"improvementPoints":[string]}',
  ].join("\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: image.mimeType, data: image.data } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[submitWrittenDrillResult] Gemini error:", response.status, errorText.slice(0, 1000));
    throw new functions.https.HttpsError("internal", "AI採点に失敗しました。");
  }

  const json = await response.json() as any;
  const responseText = json?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("") || "";
  const parsed = extractJsonObject(responseText);
  return {
    score: clampScore(parsed?.score),
    transcription: clampString(parsed?.transcription, 2000),
    detectedAnswer: clampString(parsed?.detectedAnswer, 300),
    rubricScores: normalizeRubricScores(parsed?.rubricScores, rubricCriteria),
    feedback: clampString(parsed?.feedback, 1200),
    improvementPoints: Array.isArray(parsed?.improvementPoints)
      ? parsed.improvementPoints.slice(0, 5).map((point: unknown) => clampString(point, 300)).filter(Boolean)
      : [],
    usageMetadata: {
      model,
      promptTokenCount: Math.max(0, Math.round(Number(json?.usageMetadata?.promptTokenCount) || 0)),
      candidatesTokenCount: Math.max(0, Math.round(Number(json?.usageMetadata?.candidatesTokenCount) || 0)),
      totalTokenCount: Math.max(0, Math.round(Number(json?.usageMetadata?.totalTokenCount) || 0)),
    },
  };
}

export const submitWrittenDrillResult = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, memory: "512MB", invoker: "public" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "認証が必要です。");
    }

    const callerEmail = context.auth.token.email || "";
    const isAllowedDomain = callerEmail.endsWith("@shibaurafzk.com");
    const isIndividualAllowed = context.auth.token.admin === true || context.auth.token.appAccess === true;
    if (!isAllowedDomain && !isIndividualAllowed) {
      throw new functions.https.HttpsError("permission-denied", "このサービスの対象外アカウントです。");
    }

    const { attemptId, unitId: rawUnitId, questionId: rawQuestionId, time: rawTime, answerImageDataUrl } = data as any;
    const unitId = clampString(rawUnitId, 120);
    const questionId = clampString(rawQuestionId, 120);
    const imageDataUrl = typeof answerImageDataUrl === "string" ? answerImageDataUrl : "";
    const rawTimeNumber = Number(rawTime);
    const time = Math.max(1, Math.round(rawTimeNumber));

    if (!unitId || !questionId || !Number.isFinite(rawTimeNumber) || rawTimeNumber < 0 || time > 86400 || imageDataUrl.length < 100) {
      throw new functions.https.HttpsError("invalid-argument", "必要なパラメータが不足しています。");
    }
    if (imageDataUrl.length > 4_500_000) {
      throw new functions.https.HttpsError("invalid-argument", "解答画像が大きすぎます。");
    }

    const uid = context.auth.uid;
    const userName = context.auth.token?.name || context.auth.token?.email || "名無し";
    const now = Timestamp.now();
    const dateStr = now.toDate().toISOString();

    const unitDoc = await db.doc(`units/${unitId}`).get();
    if (!unitDoc.exists) {
      throw new functions.https.HttpsError("not-found", "指定された記述式イベントが見つかりません。");
    }
    const unitData = unitDoc.data() || {};
    if (unitData.drillType !== "written") {
      throw new functions.https.HttpsError("failed-precondition", "この単元は記述式イベントではありません。");
    }
    if ((unitData.eventStatus || "active") !== "active") {
      throw new functions.https.HttpsError("failed-precondition", "この記述式イベントは現在受け付けていません。");
    }
    const startsAt = parseOptionalDate(unitData.eventStartsAt);
    const endsAt = parseOptionalDate(unitData.eventEndsAt);
    const nowDate = now.toDate();
    if ((startsAt && nowDate < startsAt) || (endsAt && nowDate > endsAt)) {
      throw new functions.https.HttpsError("failed-precondition", "この記述式イベントは開催期間外です。");
    }

    const unitQuestions = await loadUnitQuestions(unitId, unitData);
    if (unitQuestions.length !== 1) {
      throw new functions.https.HttpsError("failed-precondition", "記述式イベントは1問構成である必要があります。");
    }
    const question = unitQuestions.find((q) => String(q.id) === questionId);
    if (!question) {
      throw new functions.https.HttpsError("invalid-argument", "不正な問題IDが含まれています。");
    }

    const modelAnswerText = String(question.modelAnswer || question.model_answer || question.explanation || "");
    const limit = Math.max(2, Math.trunc(Number(unitData.writtenAttemptLimit) || 2));
    const limitRef = db.doc(`users/${uid}/writtenAttemptLimits/${unitId}`);
    const attemptDocId = clampString(attemptId, 120) || db.collection(`users/${uid}/attempts`).doc().id;
    const attemptRef = db.collection(`users/${uid}/attempts`).doc(attemptDocId);
    const [attemptSnap, limitSnap] = await Promise.all([attemptRef.get(), limitRef.get()]);
    if (attemptSnap.exists) {
      const existing = attemptSnap.data() || {};
      return {
        success: true,
        alreadyProcessed: true,
        isHighScore: false,
        isLevelUp: false,
        score: existing.score || 0,
        xpGain: 0,
        remainingAttempts: Math.max(0, limit - (limitSnap.data()?.usedAttempts || 0)),
        attemptOrdinal: existing.attemptOrdinal || null,
        attemptLimit: existing.attemptLimit || existing.limit || limit,
        attemptGroupId: existing.attemptGroupId || null,
        previousAttemptId: existing.previousAttemptId || null,
        isFinalAllowedAttempt: existing.isFinalAllowedAttempt || false,
        grading: existing.grading || null,
        modelAnswer: modelAnswerText,
      };
    }
    if ((limitSnap.data()?.usedAttempts || 0) >= limit) {
      throw new functions.https.HttpsError("resource-exhausted", "この記述式イベントの提出回数上限に達しています。");
    }

    const grading = await gradeWrittenAnswerWithGemini({
      unitTitle: String(unitData.title || unitId),
      questionText: String(question.question_text || ""),
      modelAnswer: modelAnswerText,
      gradingRubric: question.gradingRubric || question.grading_rubric || unitData.gradingRubric || [],
      answerImageDataUrl: imageDataUrl,
    });
    const finalXpGain = calculateWrittenXp(grading.score, Number(unitData.writtenXpBase) || 232);

    const result = await db.runTransaction(async (transaction) => {
      const userRef = db.doc(`users/${uid}`);
      const analyticsEventRef = db.collection("analytics_events").doc(`written_${attemptDocId}`);
      const [userSnap, attemptTxnSnap, limitTxnSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(attemptRef),
        transaction.get(limitRef),
      ]);

      if (attemptTxnSnap.exists) {
        return {
          success: true,
          alreadyProcessed: true,
          isHighScore: false,
          isLevelUp: false,
          xpGain: 0,
          remainingAttempts: Math.max(0, limit - (limitTxnSnap.data()?.usedAttempts || 0)),
          attemptOrdinal: attemptTxnSnap.data()?.attemptOrdinal || null,
          attemptLimit: attemptTxnSnap.data()?.attemptLimit || attemptTxnSnap.data()?.limit || limit,
          attemptGroupId: attemptTxnSnap.data()?.attemptGroupId || null,
          previousAttemptId: attemptTxnSnap.data()?.previousAttemptId || null,
          isFinalAllowedAttempt: attemptTxnSnap.data()?.isFinalAllowedAttempt || false,
          modelAnswer: modelAnswerText,
        };
      }

      const usedAttempts = limitTxnSnap.data()?.usedAttempts || 0;
      if (usedAttempts >= limit) {
        throw new functions.https.HttpsError("resource-exhausted", "この記述式イベントの提出回数上限に達しています。");
      }

      const userData = userSnap.exists ? userSnap.data() || {} : {};
      const currentXp = Number(userData.xp) || 0;
      const currentIcon = userData.icon || "📐";
      const existingWrittenStats = userData.writtenStats?.[unitId] || {};
      const previousMaxScore = Number(existingWrittenStats.maxScore) || 0;
      const isHighScore = grading.score > previousMaxScore;
      const newTotalXp = currentXp + finalXpGain;
      const oldLevelData = calculateLevelAndProgressServer(currentXp);
      const newLevelData = calculateLevelAndProgressServer(newTotalXp);
      const isLevelUp = newLevelData.level > oldLevelData.level;
      const attemptOrdinal = usedAttempts + 1;
      const remainingAttempts = Math.max(0, limit - (usedAttempts + 1));
      const attemptGroupId = `${uid}:${unitId}:${questionId}`;
      const previousAttemptId = clampString(limitTxnSnap.data()?.lastAttemptId, 120) || null;
      const isFinalAllowedAttempt = attemptOrdinal >= limit;
      const expireAt = new Date(now.toDate().getTime() + 90 * 24 * 60 * 60 * 1000);

      transaction.set(userRef, {
        xp: newTotalXp,
        level: newLevelData.level,
        title: getTitleForLevelServer(newLevelData.level),
        progressPercent: newLevelData.progressPercent,
        currentLevelXp: newLevelData.currentLevelXp,
        nextLevelXp: newLevelData.nextLevelXp,
        updatedAt: dateStr,
        ...(currentIcon !== "📐" ? {} : { icon: "📐" }),
      }, { merge: true });
      transaction.update(userRef, new FieldPath("writtenStats", unitId), {
        maxScore: isHighScore ? grading.score : previousMaxScore,
        bestAttemptId: isHighScore ? attemptDocId : (existingWrittenStats.bestAttemptId || null),
        attemptCount: (existingWrittenStats.attemptCount || 0) + 1,
        totalXpEarned: (existingWrittenStats.totalXpEarned || 0) + finalXpGain,
        remainingAttempts,
        limit,
        updatedAt: dateStr,
      });
      transaction.set(limitRef, {
        unitId,
        usedAttempts: usedAttempts + 1,
        limit,
        lastAttemptId: attemptDocId,
        lastAttemptOrdinal: attemptOrdinal,
        lastAttemptAt: now,
        updatedAt: now,
      }, { merge: true });
      transaction.set(attemptRef, {
        uid,
        userName,
        type: "written",
        unitId,
        unitTitle: String(unitData.title || unitId),
        questionId,
        score: grading.score,
        time,
        date: dateStr,
        xpGain: finalXpGain,
        includeInTotalScore: false,
        attemptOrdinal,
        attemptLimit: limit,
        attemptGroupId,
        previousAttemptId,
        isFinalAllowedAttempt,
        remainingAttempts,
        grading,
        expireAt: Timestamp.fromDate(expireAt),
      });
      transaction.set(analyticsEventRef, {
        eventType: "WRITTEN_ATTEMPT_SUBMITTED",
        eventVersion: 2,
        occurredAt: now,
        logicalDate: buildLogicalDate(now.toDate()),
        attemptId: attemptDocId,
        uid,
        unitId,
        unitTitle: String(unitData.title || unitId),
        subject: unitData.subject || "math",
        category: unitData.category || "written",
        score: grading.score,
        timeSec: time,
        xpGain: finalXpGain,
        attemptOrdinal,
        attemptLimit: limit,
        attemptGroupId,
        previousAttemptId,
        isFinalAllowedAttempt,
        remainingAttempts,
        source: "submitWrittenDrillResult",
        includeInTotalScore: false,
        questionResults: [{
          questionId,
          questionOrder: Number(question.order || 1),
          score: grading.score,
          attemptOrdinal,
          attemptLimit: limit,
          attemptGroupId,
          previousAttemptId,
          isFinalAllowedAttempt,
        }],
      });

      return {
        success: true,
        isHighScore,
        isLevelUp,
        oldLevel: oldLevelData.level,
        newLevel: newLevelData.level,
        xpGain: finalXpGain,
        newTotalXp,
        remainingAttempts,
        attemptOrdinal,
        attemptLimit: limit,
        attemptGroupId,
        previousAttemptId,
        isFinalAllowedAttempt,
        grading,
        modelAnswer: modelAnswerText,
        _leaderboardUpdate: isLevelUp ? { uid, userName, currentIcon, newLevel: newLevelData.level, newTotalXp } : null,
      };
    });

    const resultAny = result as any;
    if (resultAny._leaderboardUpdate) {
      try {
        await updateLeaderboard(resultAny._leaderboardUpdate);
      } catch (leaderboardErr) {
        console.error("[submitWrittenDrillResult] Leaderboard update failed (non-critical):", leaderboardErr);
      }
    }
    const { _leaderboardUpdate: _lb, ...clientResult } = resultAny;
    return { ...clientResult, score: grading.score };
  });

export const resetWrittenEventData = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "管理者のみがこの操作を実行できます。"
    );
  }

  const unitId = clampString((data as any)?.unitId, 120);
  const restoreXp = (data as any)?.restoreXp === true;
  if (!unitId) {
    throw new functions.https.HttpsError("invalid-argument", "unitId is required.");
  }

  const unitSnap = await db.doc(`units/${unitId}`).get();
  if (!unitSnap.exists || !isMathWrittenUnit(unitSnap.data() || {})) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "指定された単元は数学の記述式イベントではありません。"
    );
  }

  const attemptsSnap = await db.collectionGroup("attempts")
    .where("type", "==", "written")
    .where("unitId", "==", unitId)
    .get();

  const xpByUid = new Map<string, number>();
  const touchedUids = new Set<string>();

  for (let index = 0; index < attemptsSnap.docs.length; index += 150) {
    const batch = db.batch();
    attemptsSnap.docs.slice(index, index + 150).forEach((attemptDoc) => {
      const attempt = attemptDoc.data() || {};
      const pathSegments = attemptDoc.ref.path.split("/");
      const uid = clampString(attempt.uid || pathSegments[1], 128);
      if (uid) {
        touchedUids.add(uid);
        if (restoreXp) {
          xpByUid.set(uid, (xpByUid.get(uid) || 0) + Math.max(0, Number(attempt.xpGain) || 0));
        }
      }
      batch.delete(attemptDoc.ref);
      batch.delete(db.collection("analytics_events").doc(`written_${attemptDoc.id}`));
    });
    await batch.commit();
  }

  const limitDocsSnap = await db.collectionGroup("writtenAttemptLimits")
    .where("unitId", "==", unitId)
    .get();
  for (let index = 0; index < limitDocsSnap.docs.length; index += 400) {
    const batch = db.batch();
    limitDocsSnap.docs.slice(index, index + 400).forEach((limitDoc) => {
      const pathSegments = limitDoc.ref.path.split("/");
      const uid = clampString(limitDoc.data()?.uid || pathSegments[1], 128);
      if (uid) {
        touchedUids.add(uid);
      }
      batch.delete(limitDoc.ref);
    });
    await batch.commit();
  }

  let restoredXp = 0;
  const touchedUidList = Array.from(touchedUids);
  for (let index = 0; index < touchedUidList.length; index += 400) {
    const batch = db.batch();
    const users = await Promise.all(touchedUidList.slice(index, index + 400).map(async (uid) => {
      const userRef = db.doc(`users/${uid}`);
      const userSnap = await userRef.get();
      return { uid, userRef, userSnap };
    }));

    users.forEach(({ uid, userRef, userSnap }) => {
      if (!userSnap.exists) return;

      const updatePayload: Record<string, unknown> = {
        updatedAt: Timestamp.now().toDate().toISOString(),
      };
      if (restoreXp) {
        const xpDelta = xpByUid.get(uid) || 0;
        restoredXp += xpDelta;
        const currentXp = Math.max(0, Number(userSnap.data()?.xp) || 0);
        const newXp = Math.max(0, currentXp - xpDelta);
        const levelData = calculateLevelAndProgressServer(newXp);
        updatePayload.xp = newXp;
        updatePayload.level = levelData.level;
        updatePayload.title = getTitleForLevelServer(levelData.level);
        updatePayload.progressPercent = levelData.progressPercent;
        updatePayload.currentLevelXp = levelData.currentLevelXp;
        updatePayload.nextLevelXp = levelData.nextLevelXp;
      }

      batch.update(
        userRef,
        new FieldPath("writtenStats", unitId), FieldValue.delete(),
        ...Object.entries(updatePayload).flatMap(([key, value]) => [key, value])
      );
    });

    await batch.commit();
  }

  await db.collection("analytics_events").doc(`reset_written_${safeAnalyticsEventIdPart(unitId)}_${Date.now()}`).set({
    eventType: "WRITTEN_EVENT_DATA_RESET",
    eventVersion: 2,
    occurredAt: Timestamp.now(),
    logicalDate: buildLogicalDate(new Date()),
    unitId,
    restoreXp,
    deletedAttempts: attemptsSnap.size,
    deletedAttemptLimitDocs: limitDocsSnap.size,
    touchedUsers: touchedUids.size,
    restoredXp,
    clearsAttemptOrdinalState: true,
    source: "resetWrittenEventData",
    actor: context.auth.uid,
  });

  return {
    success: true,
    unitId,
    deletedAttempts: attemptsSnap.size,
    touchedUsers: touchedUids.size,
    restoredXp,
  };
});

// ==========================================
// 3. updateLeaderboard — リーダーボード更新ヘルパー
// ==========================================
async function updateLeaderboard(info: {
  uid: string;
  userName: string;
  currentIcon: string;
  newLevel: number;
  newTotalXp: number;
}) {
  const leaderboardRef = db.doc("leaderboards/overall");

  // ユーザードキュメントから最新のtotalScoreを取得
  const userSnap = await db.doc(`users/${info.uid}`).get();
  const userData = userSnap.data();
  if (!userData) return;

  const totalScore = userData.totalScore || 0;
  const xp = userData.xp || 0;
  // icon と level もユーザードキュメントから最新値を取得（アイコン変更の反映遅延を防ぐ）
  const icon = userData.icon || info.currentIcon;
  const level = userData.level || info.newLevel;

  const leaderboardSnap = await leaderboardRef.get();
  let rankings: any[] = [];

  if (leaderboardSnap.exists) {
    rankings = leaderboardSnap.data()?.rankings || [];
  }

  // 既存エントリを更新 or 新規追加
  const existingIdx = rankings.findIndex((r: any) => r.uid === info.uid);
  const entry = {
    uid: info.uid,
    name: info.userName,
    totalScore,
    xp,
    icon,
    level,
  };

  if (existingIdx >= 0) {
    rankings[existingIdx] = entry;
  } else {
    rankings.push(entry);
  }

  // ソート: totalScore 降順 → xp 降順
  rankings.sort((a: any, b: any) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return b.xp - a.xp;
  });

  // 上位40名のみ保持
  rankings = rankings.slice(0, 40);


  // 参加者数を stats/global カウンターから取得（全ユーザー走査を回避）
  const globalStatsSnap = await db.doc("stats/global").get();
  const totalParticipants = globalStatsSnap.exists ? (globalStatsSnap.data()?.totalParticipants || rankings.length) : rankings.length;

  await leaderboardRef.set({
    rankings,
    totalParticipants,
    updatedAt: new Date().toISOString(),
  });

  console.log(`[updateLeaderboard] Updated: ${rankings.length} entries, ${totalParticipants} total participants`);
}

// ==========================================
// initializeAdminClaims — 初回セットアップ用
// (セキュリティ向上のため削除済み)
// ==========================================

// ==========================================
// 4. listAdmins — 管理者一覧を取得
// ==========================================
export const listAdmins = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "管理者のみがこの操作を実行できます。"
    );
  }

  const admins: Array<{ uid: string; email: string; displayName: string }> = [];

  // Firebase Auth の全ユーザーを走査して admin Claim を持つユーザーを抽出
  let nextPageToken: string | undefined;
  do {
    const listResult = await auth.listUsers(1000, nextPageToken);
    for (const userRecord of listResult.users) {
      if (userRecord.customClaims?.admin === true) {
        admins.push({
          uid: userRecord.uid,
          email: userRecord.email || "",
          displayName: userRecord.displayName || "名前なし",
        });
      }
    }
    nextPageToken = listResult.pageToken;
  } while (nextPageToken);

  return { admins };
});

export const listAppAccessAccounts = functions.region("us-central1").https.onCall(async (_data, context) => {
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only admins can list app access accounts."
    );
  }

  const accounts: Array<{ uid: string; email: string; displayName: string; appAccess: boolean }> = [];
  let nextPageToken: string | undefined;
  do {
    const listResult = await auth.listUsers(1000, nextPageToken);
    for (const userRecord of listResult.users) {
      if (userRecord.customClaims?.appAccess === true) {
        accounts.push({
          uid: userRecord.uid,
          email: userRecord.email || "",
          displayName: userRecord.displayName || "",
          appAccess: true,
        });
      }
    }
    nextPageToken = listResult.pageToken;
  } while (nextPageToken);

  const inviteSnap = await db.collection("accessInvites").where("allowed", "==", true).get();
  const invites = inviteSnap.docs.map((docSnap) => {
    const invite = docSnap.data() || {};
    return {
      email: String(invite.email || docSnap.id),
      createdAt: invite.createdAt?.toDate?.()?.toISOString?.() || "",
      createdByEmail: String(invite.createdByEmail || ""),
    };
  });

  return { accounts, invites };
});

