import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { publicRankingName } from "./publicRankingName";

const db = () => admin.firestore();

const MATH_MAX_LEVEL = 100;
const MATH_LEVEL_XP_CAP_LEVEL = 40;
const OVERALL_LEADERBOARD_LIMIT = 40;
const MAX_BATCH_DELETE_ATTEMPTS = 200;

export type MathLevelData = {
  level: number;
  title: string;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
};

export function calculateMathXpForNextLevel(level: number): number {
  const cappedLevel = Math.min(Math.max(1, level), MATH_LEVEL_XP_CAP_LEVEL);
  return Math.floor(2.2 * Math.pow(cappedLevel, 2)) + 50;
}

export function getMathTitleForLevel(level: number): string {
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
  return "算数卒業生";
}

export function calculateMathLevelData(totalXp: number): MathLevelData {
  const safeXp = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;
  let level = 1;
  let accumulatedXp = 0;

  while (level < MATH_MAX_LEVEL) {
    const xpForNext = calculateMathXpForNextLevel(level);
    if (safeXp >= accumulatedXp + xpForNext) {
      accumulatedXp += xpForNext;
      level++;
    } else {
      const currentLevelXp = safeXp - accumulatedXp;
      const progressPercent = Math.min(100, Math.max(0, (currentLevelXp / xpForNext) * 100));
      return {
        level,
        title: getMathTitleForLevel(level),
        currentLevelXp,
        nextLevelXp: xpForNext,
        progressPercent,
      };
    }
  }

  return {
    level: MATH_MAX_LEVEL,
    title: getMathTitleForLevel(MATH_MAX_LEVEL),
    currentLevelXp: 0,
    nextLevelXp: 0,
    progressPercent: 100,
  };
}

export type OverallLeaderboardEntry = {
  uid: string;
  name: string;
  totalScore: number;
  xp: number;
  icon: string;
  level: number;
};

export function syncOverallLeaderboardEntry(
  rankings: unknown,
  entry: OverallLeaderboardEntry,
): OverallLeaderboardEntry[] {
  const list: OverallLeaderboardEntry[] = Array.isArray(rankings)
    ? rankings
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({
          uid: String(item.uid || ""),
          name: publicRankingName(item.name),
          totalScore: Math.max(0, Number(item.totalScore) || 0),
          xp: Math.max(0, Number(item.xp) || 0),
          icon: typeof item.icon === "string" && item.icon ? item.icon : "📐",
          level: Math.max(1, Number(item.level) || 1),
        }))
        .filter((item) => item.uid.length > 0)
    : [];

  const normalizedEntry: OverallLeaderboardEntry = {
    uid: entry.uid,
    name: publicRankingName(entry.name),
    totalScore: Math.max(0, Number(entry.totalScore) || 0),
    xp: Math.max(0, Number(entry.xp) || 0),
    icon: entry.icon || "📐",
    level: Math.max(1, Number(entry.level) || 1),
  };

  const existingIndex = list.findIndex((item) => item.uid === normalizedEntry.uid);
  if (existingIndex >= 0) {
    list[existingIndex] = normalizedEntry;
  } else {
    list.push(normalizedEntry);
  }

  list.sort((left, right) => {
    if (right.totalScore !== left.totalScore) {
      return right.totalScore - left.totalScore;
    }
    return right.xp - left.xp;
  });

  return list.slice(0, OVERALL_LEADERBOARD_LIMIT);
}

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const size = Math.max(1, Math.trunc(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function assertAdmin(context: functions.https.CallableContext): string {
  if (!context.auth || context.auth.token.admin !== true) {
    throw new functions.https.HttpsError("permission-denied", "管理者のみがこの操作を実行できます。");
  }
  return context.auth.uid;
}

function parseDocSegment(value: unknown, label: string): string {
  const trimmed = typeof value === "string" ? value.trim().slice(0, 128) : "";
  if (!trimmed || trimmed.includes("/") || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new functions.https.HttpsError("invalid-argument", `不正な ${label} です。`);
  }
  return trimmed;
}

function buildTokyoLogicalDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function safeAnalyticsDocPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) || "unknown";
}

export const adminUpdateUserXp = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    assertAdmin(context);

    const uid = parseDocSegment((data as Record<string, unknown>)?.uid, "uid");
    const rawXp = Number((data as Record<string, unknown>)?.xp);
    if (!Number.isFinite(rawXp) || rawXp < 0 || rawXp > 10_000_000) {
      throw new functions.https.HttpsError("invalid-argument", "XPは0以上の有効な数値で指定してください。");
    }
    const newXp = Math.floor(rawXp);
    const levelData = calculateMathLevelData(newXp);
    const updatedAt = new Date().toISOString();

    const userRef = db().doc(`users/${uid}`);
    const leaderboardRef = db().doc("leaderboards/overall");

    await db().runTransaction(async (transaction) => {
      const [userSnap, leaderboardSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(leaderboardRef),
      ]);

      if (!userSnap.exists) {
        throw new functions.https.HttpsError("not-found", "対象ユーザーが見つかりません。");
      }

      const userData = userSnap.data() || {};
      transaction.update(userRef, {
        xp: newXp,
        level: levelData.level,
        title: levelData.title,
        progressPercent: levelData.progressPercent,
        currentLevelXp: levelData.currentLevelXp,
        nextLevelXp: levelData.nextLevelXp,
        updatedAt,
      });

      const currentRankings = leaderboardSnap.exists ? leaderboardSnap.data()?.rankings : [];
      const isRanked = Array.isArray(currentRankings)
        && currentRankings.some((entry: Record<string, unknown>) => entry?.uid === uid);
      const totalScore = Math.max(0, Number(userData.totalScore) || 0);
      if (isRanked || totalScore > 0 || newXp > 0) {
        const nextRankings = syncOverallLeaderboardEntry(currentRankings, {
          uid,
          name: String(userData.displayName || userData.name || ""),
          totalScore,
          xp: newXp,
          icon: String(userData.icon || "📐"),
          level: levelData.level,
        });
        transaction.set(
          leaderboardRef,
          {
            rankings: nextRankings,
            updatedAt,
          },
          { merge: true }
        );
      }
    });

    return {
      success: true,
      uid,
      xp: newXp,
      level: levelData.level,
      title: levelData.title,
      progressPercent: levelData.progressPercent,
      currentLevelXp: levelData.currentLevelXp,
      nextLevelXp: levelData.nextLevelXp,
    };
  });

export const adminDeleteAttempts = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onCall(async (data, context) => {
    const actorUid = assertAdmin(context);
    const payload = (data || {}) as Record<string, unknown>;
    const rawItems = payload.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_BATCH_DELETE_ATTEMPTS) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `削除対象は1件以上${MAX_BATCH_DELETE_ATTEMPTS}件以下で指定してください。`
      );
    }

    const reason =
      typeof payload.reason === "string" && payload.reason.trim()
        ? payload.reason.trim().slice(0, 80)
        : "admin_attempt_delete";

    const uniqueTargets = new Map<string, { uid: string; attemptId: string }>();
    for (const rawItem of rawItems) {
      const item = (rawItem || {}) as Record<string, unknown>;
      const uid = parseDocSegment(item.uid, "uid");
      const attemptId = parseDocSegment(item.attemptId, "attemptId");
      uniqueTargets.set(`${uid}/${attemptId}`, { uid, attemptId });
    }

    const targetList = Array.from(uniqueTargets.values());
    const attemptRefs = targetList.map((target) =>
      db().doc(`users/${target.uid}/attempts/${target.attemptId}`)
    );
    const attemptSnaps = await db().getAll(...attemptRefs);

    const xpDeductionsByUid = new Map<string, number>();
    const existingDeletes: Array<{
      ref: FirebaseFirestore.DocumentReference;
      uid: string;
      attemptId: string;
      unitId: string | null;
    }> = [];

    attemptSnaps.forEach((snap, index) => {
      if (!snap.exists) return;
      const target = targetList[index];
      const attemptData = snap.data() || {};
      const actualXpGain = Math.max(0, Number(attemptData.xpGain) || 0);
      if (actualXpGain > 0) {
        xpDeductionsByUid.set(target.uid, (xpDeductionsByUid.get(target.uid) || 0) + actualXpGain);
      }
      existingDeletes.push({
        ref: snap.ref,
        uid: target.uid,
        attemptId: target.attemptId,
        unitId: typeof attemptData.unitId === "string" ? attemptData.unitId : null,
      });
    });

    if (existingDeletes.length === 0) {
      return { success: true, deletedCount: 0, updatedUsers: [] };
    }

    const now = Timestamp.now();
    const logicalDate = buildTokyoLogicalDate(now.toDate());
    const deleteBatchChunks = chunkArray(existingDeletes, 200);
    for (const chunk of deleteBatchChunks) {
      const batch = db().batch();
      chunk.forEach((item, index) => {
        batch.delete(item.ref);
        const eventDocId = `delete_${safeAnalyticsDocPart(item.attemptId)}_${now.toMillis()}_${index}`;
        batch.set(db().collection("analytics_events").doc(eventDocId), {
          eventType: "ATTEMPT_DELETED",
          eventVersion: 1,
          occurredAt: now,
          logicalDate,
          attemptId: item.attemptId,
          uid: item.uid,
          unitId: item.unitId,
          source: "admin",
          reason,
          actor: actorUid,
        });
      });
      await batch.commit();
    }

    const updatedUsers: Array<{ uid: string; xp: number; level: number; title: string }> = [];
    const affectedUids = Array.from(xpDeductionsByUid.keys());

    if (affectedUids.length > 0) {
      const updatedAt = now.toDate().toISOString();
      await db().runTransaction(async (transaction) => {
        const leaderboardRef = db().doc("leaderboards/overall");
        const userRefs = affectedUids.map((uid) => db().doc(`users/${uid}`));
        const [leaderboardSnap, ...userSnaps] = await Promise.all([
          transaction.get(leaderboardRef),
          ...userRefs.map((ref) => transaction.get(ref)),
        ]);

        let rankings = leaderboardSnap.exists ? leaderboardSnap.data()?.rankings : [];

        userSnaps.forEach((userSnap, index) => {
          if (!userSnap.exists) return;
          const uid = affectedUids[index];
          const userData = userSnap.data() || {};
          const deduction = xpDeductionsByUid.get(uid) || 0;
          const currentXp = Math.max(0, Number(userData.xp) || 0);
          const newXp = Math.max(0, currentXp - deduction);
          const levelData = calculateMathLevelData(newXp);

          transaction.update(userRefs[index], {
            xp: newXp,
            level: levelData.level,
            title: levelData.title,
            progressPercent: levelData.progressPercent,
            currentLevelXp: levelData.currentLevelXp,
            nextLevelXp: levelData.nextLevelXp,
            updatedAt,
          });

          updatedUsers.push({
            uid,
            xp: newXp,
            level: levelData.level,
            title: levelData.title,
          });

          const isRanked = Array.isArray(rankings)
            && rankings.some((entry: Record<string, unknown>) => entry?.uid === uid);
          if (isRanked) {
            rankings = syncOverallLeaderboardEntry(rankings, {
              uid,
              name: String(userData.displayName || userData.name || ""),
              totalScore: Math.max(0, Number(userData.totalScore) || 0),
              xp: newXp,
              icon: String(userData.icon || "📐"),
              level: levelData.level,
            });
          }
        });

        if (leaderboardSnap.exists && Array.isArray(rankings)) {
          transaction.set(
            leaderboardRef,
            {
              rankings,
              updatedAt,
            },
            { merge: true }
          );
        }
      });
    }

    return {
      success: true,
      deletedCount: existingDeletes.length,
      updatedUsers,
    };
  });

async function deleteCollectionGroupDocs(groupName: string): Promise<number> {
  let deleted = 0;
  while (true) {
    const snap = await db().collectionGroup(groupName).limit(400).get();
    if (snap.empty) break;
    const batch = db().batch();
    snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < 400) break;
  }
  return deleted;
}

export const adminResetAllData = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onCall(async (_data, context) => {
    const actorUid = assertAdmin(context);
    const now = Timestamp.now();
    const nowIso = now.toDate().toISOString();

    await db().collection("analytics_events").doc(`reset_${now.toMillis()}`).set({
      eventType: "ALL_DATA_RESET",
      eventVersion: 1,
      occurredAt: now,
      logicalDate: buildTokyoLogicalDate(now.toDate()),
      source: "admin",
      actor: actorUid,
    });

    const [deletedAttempts, deletedWrongs, deletedWrittenLimits] = await Promise.all([
      deleteCollectionGroupDocs("attempts"),
      deleteCollectionGroupDocs("wrong_answers"),
      deleteCollectionGroupDocs("writtenAttemptLimits"),
    ]);

    await db().doc("stats/global").set({
      totalParticipants: 0,
      updatedAt: nowIso,
    });

    const usersSnap = await db().collection("users").select("learningGeneration").get();
    for (const chunk of chunkArray(usersSnap.docs, 400)) {
      const batch = db().batch();
      chunk.forEach((userDoc) => {
        const previousGeneration = Math.max(1, Number(userDoc.data()?.learningGeneration) || 1);
        batch.update(userDoc.ref, {
          xp: 0,
          level: 1,
          title: "算数卒業生",
          icon: "📐",
          progressPercent: 0,
          currentLevelXp: 0,
          nextLevelXp: calculateMathXpForNextLevel(1),
          totalScore: 0,
          unitStats: {},
          hasParticipated: false,
          learningGeneration: previousGeneration + 1,
          learningResetAt: now,
          writtenStats: FieldValue.delete(),
          unlockedIcons: FieldValue.delete(),
          learningDailyV1: FieldValue.delete(),
          lastAttemptTimes: FieldValue.delete(),
          integrityGuardV1: FieldValue.delete(),
          updatedAt: nowIso,
        });
      });
      await batch.commit();
    }

    const lbSnap = await db().collection("leaderboards").get();
    for (const chunk of chunkArray(lbSnap.docs, 400)) {
      const batch = db().batch();
      chunk.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
    }

    return {
      success: true,
      resetUserCount: usersSnap.size,
      deletedAttempts,
      deletedWrongs,
      deletedWrittenLimits,
    };
  });

export const adminResetAllKanjiData = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onCall(async (data, context) => {
    assertAdmin(context);
    const payload = (data || {}) as Record<string, unknown>;
    const archiveDocumentId = parseDocSegment(payload.archiveDocumentId, "archiveDocumentId");
    const seasonId = parseDocSegment(payload.seasonId, "seasonId");
    const seasonNumber = Math.max(1, Math.trunc(Number(payload.seasonNumber) || 1));
    const certificationLevel = Math.max(1, Math.trunc(Number(payload.certificationLevel) || 100));
    const defaultBadgeImageUrl =
      typeof payload.badgeImageUrl === "string" && payload.badgeImageUrl.trim()
        ? payload.badgeImageUrl.trim().slice(0, 200)
        : `/images/kanji-season${seasonNumber}-badge.png`;

    const archiveRef = db().doc(`leaderboards/${archiveDocumentId}`);
    const archiveSnap = await archiveRef.get();
    if (!archiveSnap.exists) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `先に Season ${seasonNumber} を保存し、通常・対戦の上位者を確認してください。`
      );
    }

    const archive = archiveSnap.data() || {};
    if (
      archive.seasonId !== seasonId ||
      !Array.isArray(archive.certifiedUsers) ||
      !Array.isArray(archive.topXpRankings) ||
      !Array.isArray(archive.topBattleRankings)
    ) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "保存済みシーズン記録の形式が不正です。初期化を中止しました。"
      );
    }

    if (archive.resetCompletedAt) {
      return {
        success: true,
        alreadyCompleted: true,
        resetUserCount: 0,
        certifiedCount: archive.certifiedUsers.length,
        completedAt: String(archive.resetCompletedAt),
      };
    }

    const certifiedUsers = new Map<string, Record<string, unknown>>();
    for (const item of archive.certifiedUsers as Array<Record<string, unknown>>) {
      if (item && typeof item.uid === "string" && item.uid) {
        certifiedUsers.set(item.uid, item);
      }
    }

    const usersSnap = await db().collection("users").select("uid").get();
    const completedAt = new Date().toISOString();
    const archivedAt = typeof archive.archivedAt === "string" && archive.archivedAt
      ? archive.archivedAt
      : completedAt;

    for (const chunk of chunkArray(usersSnap.docs, 400)) {
      const batch = db().batch();
      chunk.forEach((userDoc) => {
        const certifiedUser = certifiedUsers.get(userDoc.id);
        const level = Number(certifiedUser?.level || 0);
        const awardBadge = Boolean(certifiedUser) && level >= certificationLevel;
        const badgePayload = awardBadge
          ? {
              seasonId,
              seasonNumber,
              label: `Season ${seasonNumber} 認証`,
              title: "万葉の匠",
              awardedAt: archivedAt,
              level,
              xp: Number(certifiedUser?.xp || 0),
              badgeImageUrl:
                typeof certifiedUser?.badgeImageUrl === "string" && certifiedUser.badgeImageUrl
                  ? certifiedUser.badgeImageUrl
                  : defaultBadgeImageUrl,
            }
          : null;

        const args: [string | FieldPath, unknown, ...(string | FieldPath | unknown)[]] = [
          "kanjiTitle", FieldValue.delete(),
          "kanjiProgressPercent", FieldValue.delete(),
          "kanjiCurrentLevelXp", FieldValue.delete(),
          "kanjiNextLevelXp", FieldValue.delete(),
          "kanjiUnitStats", FieldValue.delete(),
          "kanjiUpdatedAt", FieldValue.delete(),
          "kanjiIcon", FieldValue.delete(),
          "kanjiXp", 0,
          "kanjiLevel", 1,
          "kanjiTotalScore", 0,
          "kanjiBattleStats", { wins: 0, xp: 0, totalBattles: 0 },
          "kanjiBattleWins", 0,
          "kanjiBattleXp", 0,
        ];

        if (badgePayload) {
          args.push(new FieldPath("kanjiSeasonBadges", seasonId), badgePayload);
        }

        batch.update(userDoc.ref, args[0], args[1], ...args.slice(2));
      });
      await batch.commit();
    }

    const lbBatch = db().batch();
    lbBatch.set(db().doc("leaderboards/kanji"), { rankings: [], updatedAt: completedAt }, { merge: true });
    lbBatch.set(db().doc("leaderboards/kanjiBattle"), { rankings: [], updatedAt: completedAt }, { merge: true });
    lbBatch.update(archiveRef, { resetCompletedAt: completedAt });
    await lbBatch.commit();

    return {
      success: true,
      alreadyCompleted: false,
      resetUserCount: usersSnap.size,
      certifiedCount: certifiedUsers.size,
      completedAt,
    };
  });
