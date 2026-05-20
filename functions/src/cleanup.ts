import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

const db = admin.firestore();
const realtimeDb = admin.database();

const RETENTION = {
  attemptsDays: 90,
  analyticsEventsDays: 180,
  suspiciousActivitiesDays: 30,
  maxDeletesPerCollection: 400,
  maxLoopCount: 5,
  // 作成から何時間後のルームを削除するか（BATTLE_ROOM_TTL_MS の 2 倍の余裕を持たせる）
  battleRoomGracePeriodHours: 2,
} as const;

async function deleteExpiredRtdbRooms(path: string): Promise<number> {
  const cutoff = Date.now() - RETENTION.battleRoomGracePeriodHours * 60 * 60 * 1000;
  const snap = await realtimeDb.ref(path)
    .orderByChild("expiresAt")
    .endAt(cutoff)
    .get();

  if (!snap.exists()) return 0;

  const updates: Record<string, null> = {};
  snap.forEach((child) => {
    updates[child.key!] = null;
  });
  await realtimeDb.ref(path).update(updates);

  const count = Object.keys(updates).length;
  functions.logger.info(`[cleanupRetentionData] deleted ${count} expired rooms from ${path}`);
  return count;
}

async function deleteQueryBatch(
  getQuery: () => FirebaseFirestore.Query<FirebaseFirestore.DocumentData>,
  label: string
): Promise<number> {
  let deleted = 0;

  for (let i = 0; i < RETENTION.maxLoopCount; i++) {
    const snapshot = await getQuery().limit(RETENTION.maxDeletesPerCollection).get();
    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;

    functions.logger.info(`[cleanupRetentionData] deleted ${snapshot.size} docs from ${label}`);

    if (snapshot.size < RETENTION.maxDeletesPerCollection) {
      break;
    }
  }

  return deleted;
}

export const cleanupRetentionData = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("every day 03:30")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const attemptsCutoff = now;
    const analyticsCutoff = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - RETENTION.analyticsEventsDays * 24 * 60 * 60 * 1000)
    );
    const suspiciousCutoff = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - RETENTION.suspiciousActivitiesDays * 24 * 60 * 60 * 1000)
    );

    const deletedAttempts = await deleteQueryBatch(
      () => db.collectionGroup("attempts").where("expireAt", "<=", attemptsCutoff).orderBy("expireAt"),
      "users/*/attempts"
    );

    const deletedAnalyticsEvents = await deleteQueryBatch(
      () => db.collection("analytics_events").where("occurredAt", "<=", analyticsCutoff).orderBy("occurredAt"),
      "analytics_events"
    );

    const deletedSuspiciousActivities = await deleteQueryBatch(
      () => db.collection("suspicious_activities").where("timestamp", "<=", suspiciousCutoff).orderBy("timestamp"),
      "suspicious_activities"
    );

    const [deletedKanjiBattleRooms, deletedBattleRooms] = await Promise.all([
      deleteExpiredRtdbRooms("kanjiBattleRooms"),
      deleteExpiredRtdbRooms("battleRooms"),
    ]);

    functions.logger.info("[cleanupRetentionData] completed", {
      deletedAttempts,
      deletedAnalyticsEvents,
      deletedSuspiciousActivities,
      deletedKanjiBattleRooms,
      deletedBattleRooms,
      retention: RETENTION,
    });

    return {
      deletedAttempts,
      deletedAnalyticsEvents,
      deletedSuspiciousActivities,
      deletedKanjiBattleRooms,
      deletedBattleRooms,
    };
  });
