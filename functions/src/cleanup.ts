import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

const db = admin.firestore();

const RETENTION = {
  attemptsDays: 90,
  analyticsEventsDays: 180,
  suspiciousActivitiesDays: 30,
  maxDeletesPerCollection: 400,
  maxLoopCount: 5,
} as const;

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

    functions.logger.info("[cleanupRetentionData] completed", {
      deletedAttempts,
      deletedAnalyticsEvents,
      deletedSuspiciousActivities,
      retention: RETENTION,
    });

    return {
      deletedAttempts,
      deletedAnalyticsEvents,
      deletedSuspiciousActivities,
    };
  });
