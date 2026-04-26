import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { BigQuery } from "@google-cloud/bigquery";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type AnalyticsConfig = {
  projectId: string;
  datasetId: string;
  location: string;
  sourceTablePrefix: string;
  timezone: string;
  servingRoot: string;
};

type UnitMetadata = {
  unitId: string;
  unitTitle: string;
  subject: string;
  category: string;
  questions: Array<{
    questionId: string;
    questionOrder: number;
    questionText: string;
  }>;
};

type AttemptBackfillQuestionResult = {
  questionId: string;
  questionOrder: number;
  isCorrect: boolean;
};

type AttemptSubmittedAnalyticsEvent = {
  eventType: "ATTEMPT_SUBMITTED";
  eventVersion: number;
  occurredAt: admin.firestore.Timestamp;
  logicalDate: string;
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
  source: string;
  questionResults: AttemptBackfillQuestionResult[];
};

const DEFAULT_CONFIG: AnalyticsConfig = {
  projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "math-app-26c77",
  datasetId: "analytics",
  location: "asia-northeast1",
  sourceTablePrefix: "analytics_events",
  timezone: "Asia/Tokyo",
  servingRoot: "analytics_serving/current",
};

const PUBLIC_REPORT_ROOT = "public_analytics_serving/current";
const PUBLIC_REPORT_THRESHOLDS = {
  unitMinUsers: 5,
  questionMinAttempts: 10,
  questionMinUsers: 5,
  correlationMinSupportUsers: 10,
  correlationMinCoWrongUsers: 5,
} as const;

function getAnalyticsConfig(): AnalyticsConfig {
  const cloudRuntimeConfig = process.env.CLOUD_RUNTIME_CONFIG
    ? JSON.parse(process.env.CLOUD_RUNTIME_CONFIG)
    : {};
  const runtimeConfig = (cloudRuntimeConfig.analytics || {}) as Record<string, string>;

  return {
    projectId: runtimeConfig.project_id || DEFAULT_CONFIG.projectId,
    datasetId: runtimeConfig.dataset_id || DEFAULT_CONFIG.datasetId,
    location: runtimeConfig.location || DEFAULT_CONFIG.location,
    sourceTablePrefix: runtimeConfig.source_table_prefix || DEFAULT_CONFIG.sourceTablePrefix,
    timezone: runtimeConfig.timezone || DEFAULT_CONFIG.timezone,
    servingRoot: runtimeConfig.serving_root || DEFAULT_CONFIG.servingRoot,
  };
}

function assertSafeIdentifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function tableRef(config: AnalyticsConfig, tableName: string): string {
  assertSafeIdentifier(config.projectId, "project id");
  assertSafeIdentifier(config.datasetId, "dataset id");
  assertSafeIdentifier(tableName, "table name");
  return `\`${config.projectId}.${config.datasetId}.${tableName}\``;
}

function occurredAtExpr(alias = "data"): string {
  return `COALESCE(
    SAFE.TIMESTAMP(JSON_VALUE(${alias}, '$.occurredAt')),
    TIMESTAMP_SECONDS(SAFE_CAST(JSON_VALUE(${alias}, '$.occurredAt._seconds') AS INT64))
  )`;
}

function buildDifficultyCase(rateExpr: string): string {
  return `CASE
    WHEN ${rateExpr} >= 90 THEN 'very_easy'
    WHEN ${rateExpr} >= 70 THEN 'easy'
    WHEN ${rateExpr} >= 40 THEN 'normal'
    WHEN ${rateExpr} >= 20 THEN 'hard'
    ELSE 'very_hard'
  END`;
}

function buildLogicalDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildAttemptSubmittedEventFromAttempt(params: {
  attemptId: string;
  uid: string;
  unitId: string;
  unitTitle: string;
  subject: string;
  category: string;
  occurredAt: admin.firestore.Timestamp;
  score: number;
  timeSec: number;
  xpGain: number;
  questionResults: AttemptBackfillQuestionResult[];
}): AttemptSubmittedAnalyticsEvent {
  return {
    eventType: "ATTEMPT_SUBMITTED",
    eventVersion: 1,
    occurredAt: params.occurredAt,
    logicalDate: buildLogicalDate(params.occurredAt.toDate()),
    attemptId: params.attemptId,
    uid: params.uid,
    unitId: params.unitId,
    unitTitle: params.unitTitle,
    subject: params.subject,
    category: params.category,
    score: params.score,
    timeSec: params.timeSec,
    xpGain: params.xpGain,
    correctCount: params.questionResults.filter((question) => question.isCorrect).length,
    answeredCount: params.questionResults.length,
    source: "attempts_backfill",
    questionResults: params.questionResults,
  };
}

async function runQuery(
  bigquery: BigQuery,
  config: AnalyticsConfig,
  query: string,
  params?: Record<string, unknown>
) {
  const [rows] = await bigquery.query({
    query,
    location: config.location,
    useLegacySql: false,
    params,
  });
  return rows as any[];
}

function scopedWhereClause(filter?: { field: "subject" | "category"; value: string }): string {
  return filter ? `WHERE ${filter.field} = @scopeValue` : "";
}

function safeServingDocId(value: string): string {
  const encoded = encodeURIComponent(value || "unknown");
  return encoded.replace(/\./g, "%2E").slice(0, 200) || "unknown";
}

function buildFactAttemptsSql(config: AnalyticsConfig): string {
  const rawLatestTable = tableRef(config, `${config.sourceTablePrefix}_raw_latest`);
  return `
CREATE OR REPLACE TABLE ${tableRef(config, "fact_attempts")}
PARTITION BY occurred_date
CLUSTER BY unit_id, uid AS
WITH raw_events AS (
  SELECT
    data AS raw_json
  FROM ${rawLatestTable}
  WHERE data IS NOT NULL
),
last_reset AS (
  SELECT
    MAX(${occurredAtExpr("raw_json")}) AS reset_at
  FROM raw_events
  WHERE JSON_VALUE(raw_json, '$.eventType') = 'ALL_DATA_RESET'
),
submitted AS (
  SELECT
    JSON_VALUE(raw_json, '$.attemptId') AS attempt_id,
    JSON_VALUE(raw_json, '$.uid') AS uid,
    JSON_VALUE(raw_json, '$.unitId') AS unit_id,
    JSON_VALUE(raw_json, '$.unitTitle') AS unit_title,
    JSON_VALUE(raw_json, '$.subject') AS subject,
    JSON_VALUE(raw_json, '$.category') AS category,
    ${occurredAtExpr("raw_json")} AS occurred_at,
    DATE(${occurredAtExpr("raw_json")}, '${config.timezone}') AS occurred_date,
    SAFE_CAST(JSON_VALUE(raw_json, '$.score') AS INT64) AS score,
    SAFE_CAST(JSON_VALUE(raw_json, '$.timeSec') AS INT64) AS time_sec,
    SAFE_CAST(JSON_VALUE(raw_json, '$.xpGain') AS INT64) AS xp_gain,
    SAFE_CAST(JSON_VALUE(raw_json, '$.correctCount') AS INT64) AS correct_count,
    SAFE_CAST(JSON_VALUE(raw_json, '$.answeredCount') AS INT64) AS answered_count
  FROM raw_events
  WHERE JSON_VALUE(raw_json, '$.eventType') = 'ATTEMPT_SUBMITTED'
),
deleted AS (
  SELECT
    JSON_VALUE(raw_json, '$.attemptId') AS attempt_id,
    ${occurredAtExpr("raw_json")} AS deleted_at
  FROM raw_events
  WHERE JSON_VALUE(raw_json, '$.eventType') = 'ATTEMPT_DELETED'
)
SELECT s.*
FROM submitted s
LEFT JOIN deleted d
  ON d.attempt_id = s.attempt_id
CROSS JOIN last_reset lr
WHERE s.occurred_at IS NOT NULL
  AND (lr.reset_at IS NULL OR s.occurred_at > lr.reset_at)
  AND (d.deleted_at IS NULL OR d.deleted_at < s.occurred_at)
`;
}

function buildFactAttemptQuestionResultsSql(config: AnalyticsConfig): string {
  const rawLatestTable = tableRef(config, `${config.sourceTablePrefix}_raw_latest`);
  return `
CREATE OR REPLACE TABLE ${tableRef(config, "fact_attempt_question_results")}
PARTITION BY occurred_date
CLUSTER BY unit_id, question_id, uid AS
WITH raw_events AS (
  SELECT
    data AS raw_json
  FROM ${rawLatestTable}
  WHERE data IS NOT NULL
),
last_reset AS (
  SELECT
    MAX(${occurredAtExpr("raw_json")}) AS reset_at
  FROM raw_events
  WHERE JSON_VALUE(raw_json, '$.eventType') = 'ALL_DATA_RESET'
),
submitted AS (
  SELECT
    JSON_VALUE(raw_json, '$.attemptId') AS attempt_id,
    JSON_VALUE(raw_json, '$.uid') AS uid,
    JSON_VALUE(raw_json, '$.unitId') AS unit_id,
    JSON_VALUE(raw_json, '$.unitTitle') AS unit_title,
    JSON_VALUE(raw_json, '$.subject') AS subject,
    JSON_VALUE(raw_json, '$.category') AS category,
    ${occurredAtExpr("raw_json")} AS occurred_at,
    DATE(${occurredAtExpr("raw_json")}, '${config.timezone}') AS occurred_date,
    SAFE_CAST(JSON_VALUE(raw_json, '$.score') AS INT64) AS score,
    SAFE_CAST(JSON_VALUE(raw_json, '$.timeSec') AS INT64) AS time_sec,
    SAFE_CAST(JSON_VALUE(raw_json, '$.xpGain') AS INT64) AS xp_gain,
    JSON_QUERY_ARRAY(raw_json, '$.questionResults') AS question_results
  FROM raw_events
  WHERE JSON_VALUE(raw_json, '$.eventType') = 'ATTEMPT_SUBMITTED'
),
deleted AS (
  SELECT
    JSON_VALUE(raw_json, '$.attemptId') AS attempt_id,
    ${occurredAtExpr("raw_json")} AS deleted_at
  FROM raw_events
  WHERE JSON_VALUE(raw_json, '$.eventType') = 'ATTEMPT_DELETED'
)
SELECT
  s.attempt_id,
  s.uid,
  s.unit_id,
  s.unit_title,
  s.subject,
  s.category,
  s.occurred_at,
  s.occurred_date,
  JSON_VALUE(question_result, '$.questionId') AS question_id,
  SAFE_CAST(JSON_VALUE(question_result, '$.questionOrder') AS INT64) AS question_order,
  SAFE_CAST(JSON_VALUE(question_result, '$.isCorrect') AS BOOL) AS is_correct,
  s.score,
  s.time_sec,
  s.xp_gain
FROM submitted s
LEFT JOIN deleted d
  ON d.attempt_id = s.attempt_id
CROSS JOIN last_reset lr
CROSS JOIN UNNEST(s.question_results) AS question_result
WHERE s.occurred_at IS NOT NULL
  AND (lr.reset_at IS NULL OR s.occurred_at > lr.reset_at)
  AND (d.deleted_at IS NULL OR d.deleted_at < s.occurred_at)
`;
}

function buildAggUnitDailySql(config: AnalyticsConfig): string {
  return `
CREATE OR REPLACE TABLE ${tableRef(config, "agg_unit_daily")}
PARTITION BY stat_date
CLUSTER BY unit_id AS
WITH unit_question_attempts AS (
  SELECT
    occurred_date AS stat_date,
    unit_id,
    unit_title,
    subject,
    category,
    uid,
    question_id,
    is_correct,
    SAFE_DIVIDE(time_sec, NULLIF(COUNT(*) OVER (PARTITION BY attempt_id), 0)) AS question_time_sec,
    ROW_NUMBER() OVER (
      PARTITION BY uid, unit_id, question_id
      ORDER BY occurred_at, attempt_id
    ) AS question_attempt_order
  FROM ${tableRef(config, "fact_attempt_question_results")}
),
first_retry AS (
  SELECT
    stat_date,
    unit_id,
    AVG(IF(question_attempt_order = 1, CAST(is_correct AS INT64), NULL)) * 100 AS first_attempt_accuracy,
    (
      AVG(IF(question_attempt_order > 1, CAST(is_correct AS INT64), NULL)) -
      AVG(IF(question_attempt_order = 1, CAST(is_correct AS INT64), NULL))
    ) * 100 AS retry_improvement_rate
  FROM unit_question_attempts
  GROUP BY stat_date, unit_id
)
SELECT
  attempts.occurred_date AS stat_date,
  attempts.unit_id,
  ANY_VALUE(attempts.unit_title) AS unit_title,
  ANY_VALUE(attempts.subject) AS subject,
  ANY_VALUE(attempts.category) AS category,
  COUNT(*) AS total_attempts,
  COUNT(DISTINCT attempts.uid) AS unique_users,
  SUM(attempts.answered_count) AS total_answered,
  SUM(attempts.correct_count) AS total_correct,
  SAFE_DIVIDE(SUM(attempts.correct_count), NULLIF(SUM(attempts.answered_count), 0)) * 100 AS avg_accuracy,
  AVG(attempts.time_sec) AS avg_time_sec,
  COALESCE(fr.first_attempt_accuracy, 0) AS first_attempt_accuracy,
  COALESCE(fr.retry_improvement_rate, 0) AS retry_improvement_rate,
  (100 - SAFE_DIVIDE(SUM(attempts.correct_count), NULLIF(SUM(attempts.answered_count), 0)) * 100)
    * LOG10(COUNT(*) + 10) AS improvement_priority_score
FROM ${tableRef(config, "fact_attempts")} attempts
LEFT JOIN first_retry fr
  ON fr.stat_date = attempts.occurred_date
 AND fr.unit_id = attempts.unit_id
GROUP BY stat_date, unit_id, fr.first_attempt_accuracy, fr.retry_improvement_rate
`;
}

function buildAggQuestionDailySql(config: AnalyticsConfig): string {
  const difficultyExpr = buildDifficultyCase(
    "SAFE_DIVIDE(SUM(CAST(is_correct AS INT64)), NULLIF(COUNT(*), 0)) * 100"
  );
  return `
CREATE OR REPLACE TABLE ${tableRef(config, "agg_question_daily")}
PARTITION BY stat_date
CLUSTER BY unit_id, question_id AS
WITH enriched AS (
  SELECT
    occurred_date AS stat_date,
    unit_id,
    unit_title,
    subject,
    category,
    uid,
    attempt_id,
    question_id,
    question_order,
    is_correct,
    SAFE_DIVIDE(time_sec, NULLIF(COUNT(*) OVER (PARTITION BY attempt_id), 0)) AS question_time_sec,
    ROW_NUMBER() OVER (
      PARTITION BY uid, unit_id, question_id
      ORDER BY occurred_at, attempt_id
    ) AS question_attempt_order,
    AVG(CAST(is_correct AS INT64)) OVER (PARTITION BY uid, unit_id) AS user_unit_accuracy
  FROM ${tableRef(config, "fact_attempt_question_results")}
)
SELECT
  stat_date,
  unit_id,
  ANY_VALUE(unit_title) AS unit_title,
  ANY_VALUE(subject) AS subject,
  ANY_VALUE(category) AS category,
  question_id,
  ANY_VALUE(question_order) AS question_order,
  COUNT(*) AS total,
  SUM(CAST(is_correct AS INT64)) AS correct,
  SAFE_DIVIDE(SUM(CAST(is_correct AS INT64)), NULLIF(COUNT(*), 0)) * 100 AS accuracy,
  ${difficultyExpr} AS difficulty,
  AVG(IF(question_attempt_order = 1, CAST(is_correct AS INT64), NULL)) * 100 AS first_attempt_accuracy,
  (
    AVG(IF(question_attempt_order > 1, CAST(is_correct AS INT64), NULL)) -
    AVG(IF(question_attempt_order = 1, CAST(is_correct AS INT64), NULL))
  ) * 100 AS retry_improvement_rate,
  AVG(question_time_sec) AS avg_time_sec,
  CORR(CAST(is_correct AS INT64), user_unit_accuracy) AS discrimination_index,
  (100 - SAFE_DIVIDE(SUM(CAST(is_correct AS INT64)), NULLIF(COUNT(*), 0)) * 100)
    * LOG10(COUNT(*) + 10)
    + AVG(question_time_sec) AS improvement_priority_score
FROM enriched
GROUP BY stat_date, unit_id, question_id
`;
}

function buildAggQuestionPairCurrentSql(config: AnalyticsConfig): string {
  return `
CREATE OR REPLACE TABLE ${tableRef(config, "agg_question_pair_current")}
CLUSTER BY unit_id, question_id_a, question_id_b AS
WITH latest_per_user AS (
  SELECT
    unit_id,
    uid,
    question_id,
    question_order,
    is_correct,
    ROW_NUMBER() OVER (
      PARTITION BY unit_id, uid, question_id
      ORDER BY occurred_at DESC, attempt_id DESC
    ) AS row_num
  FROM ${tableRef(config, "fact_attempt_question_results")}
),
base AS (
  SELECT
    unit_id,
    uid,
    question_id,
    question_order,
    NOT is_correct AS is_incorrect
  FROM latest_per_user
  WHERE row_num = 1
),
pairs AS (
  SELECT
    left_side.unit_id,
    left_side.question_id AS question_id_a,
    right_side.question_id AS question_id_b,
    ANY_VALUE(left_side.question_order) AS question_order_a,
    ANY_VALUE(right_side.question_order) AS question_order_b,
    COUNT(*) AS support_users,
    SUM(CASE WHEN left_side.is_incorrect THEN 1 ELSE 0 END) AS wrong_users_a,
    SUM(CASE WHEN right_side.is_incorrect THEN 1 ELSE 0 END) AS wrong_users_b,
    SUM(CASE WHEN left_side.is_incorrect AND right_side.is_incorrect THEN 1 ELSE 0 END) AS co_wrong_users,
    SUM(CASE WHEN left_side.is_incorrect AND right_side.is_incorrect THEN 1 ELSE 0 END) AS n11,
    SUM(CASE WHEN left_side.is_incorrect AND NOT right_side.is_incorrect THEN 1 ELSE 0 END) AS n10,
    SUM(CASE WHEN NOT left_side.is_incorrect AND right_side.is_incorrect THEN 1 ELSE 0 END) AS n01,
    SUM(CASE WHEN NOT left_side.is_incorrect AND NOT right_side.is_incorrect THEN 1 ELSE 0 END) AS n00
  FROM base left_side
  JOIN base right_side
    ON left_side.unit_id = right_side.unit_id
   AND left_side.uid = right_side.uid
    AND left_side.question_id < right_side.question_id
  GROUP BY unit_id, question_id_a, question_id_b
),
scored AS (
  SELECT
    unit_id,
    question_id_a,
    question_id_b,
    question_order_a,
    question_order_b,
    support_users,
    wrong_users_a,
    wrong_users_b,
    co_wrong_users,
    SAFE_DIVIDE(co_wrong_users, NULLIF(wrong_users_a, 0)) * 100 AS mistake_rate_given_a,
    SAFE_DIVIDE(co_wrong_users, NULLIF(wrong_users_b, 0)) * 100 AS mistake_rate_given_b,
    SAFE_DIVIDE(
      SAFE_DIVIDE(co_wrong_users, NULLIF(support_users, 0)),
      SAFE_DIVIDE(wrong_users_a, NULLIF(support_users, 0)) * SAFE_DIVIDE(wrong_users_b, NULLIF(support_users, 0))
    ) AS lift,
    SAFE_DIVIDE(
      (n11 * n00) - (n10 * n01),
      SQRT((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00))
    ) AS phi
  FROM pairs
)
SELECT
  unit_id,
  question_id_a,
  question_id_b,
  question_order_a,
  question_order_b,
  support_users,
  wrong_users_a,
  wrong_users_b,
  co_wrong_users,
  mistake_rate_given_a,
  mistake_rate_given_b,
  lift,
  phi,
  'positive' AS direction,
  CASE
    WHEN ABS(phi) >= 0.5 THEN 'strong'
    ELSE 'moderate'
  END AS strength
FROM scored
WHERE support_users >= 5
  AND wrong_users_a >= 3
  AND wrong_users_b >= 3
  AND co_wrong_users >= 3
  AND phi > 0
  AND GREATEST(
    mistake_rate_given_a,
    mistake_rate_given_b
  ) >= 30
`;
}

async function buildDerivedTables(bigquery: BigQuery, config: AnalyticsConfig) {
  const queries = [
    buildFactAttemptsSql(config),
    buildFactAttemptQuestionResultsSql(config),
    buildAggUnitDailySql(config),
    buildAggQuestionDailySql(config),
    buildAggQuestionPairCurrentSql(config),
  ];

  for (const query of queries) {
    await runQuery(bigquery, config, query);
  }
}

async function fetchUnitMetadata(): Promise<Map<string, UnitMetadata>> {
  const unitsSnapshot = await db.collection("units").get();
  const metadata = new Map<string, UnitMetadata>();

  for (const unitDoc of unitsSnapshot.docs) {
    const unitData = unitDoc.data() as any;
    const questionsSnapshot = await unitDoc.ref.collection("questions").orderBy("order", "asc").get();
    metadata.set(unitDoc.id, {
      unitId: unitDoc.id,
      unitTitle: unitData.title || unitDoc.id,
      subject: unitData.subject || "謨ｰ蟄ｦ",
      category: unitData.category || "\u305d\u306e\u4ed6",
      questions: questionsSnapshot.docs.map((questionDoc) => {
        const questionData = questionDoc.data() as any;
        return {
          questionId: questionDoc.id,
          questionOrder: Number(questionData.order || 0),
          questionText: questionData.question_text || questionData.questionText || questionDoc.id,
        };
      }),
    });
  }

  return metadata;
}

async function fetchUserNames(): Promise<Map<string, string>> {
  const usersSnapshot = await db.collection("users").get();
  const names = new Map<string, string>();

  for (const userDoc of usersSnapshot.docs) {
    const data = userDoc.data() as any;
    names.set(
      userDoc.id,
      data.displayName || data.name || data.email || "繝ｦ繝ｼ繧ｶ繝ｼ"
    );
  }

  return names;
}

async function backfillAnalyticsEventsInternal(options?: {
  batchSize?: number;
  cursor?: string;
  overwriteExisting?: boolean;
  dryRun?: boolean;
}) {
  const batchSize = Math.max(1, Math.min(Number(options?.batchSize || 200), 500));
  const overwriteExisting = options?.overwriteExisting === true;
  const dryRun = options?.dryRun === true;
  const cursor = options?.cursor;

  const unitMetadata = await fetchUnitMetadata();
  let query: FirebaseFirestore.Query<FirebaseFirestore.QueryDocumentSnapshot> = db
    .collectionGroup("attempts")
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(batchSize);

  if (cursor) {
    query = query.startAfter(cursor);
  }

  const attemptsSnapshot = await query.get();

  if (attemptsSnapshot.empty) {
    return {
      ok: true,
      dryRun,
      processed: 0,
      written: 0,
      skippedExisting: 0,
      skippedInvalid: 0,
      skippedMissingUnit: 0,
      hasMore: false,
      nextCursor: null,
    };
  }

  const eventRefs = attemptsSnapshot.docs.map((attemptDoc) =>
    db.collection("analytics_events").doc(`submit_${attemptDoc.id}`)
  );
  const existingEventSnapshots = eventRefs.length > 0 ? await db.getAll(...eventRefs) : [];
  const existingEventIds = new Set(
    existingEventSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id)
  );

  const writeBatch = db.batch();
  let written = 0;
  let skippedExisting = 0;
  let skippedInvalid = 0;
  let skippedMissingUnit = 0;

  for (const attemptDoc of attemptsSnapshot.docs) {
    const attemptData = attemptDoc.data() as any;
    const attemptId = attemptDoc.id;
    const eventDocId = `submit_${attemptId}`;

    if (!overwriteExisting && existingEventIds.has(eventDocId)) {
      skippedExisting += 1;
      continue;
    }

    const pathSegments = attemptDoc.ref.path.split("/");
    const uidFromPath = pathSegments.length >= 2 ? pathSegments[1] : "";
    const uid = String(attemptData.uid || uidFromPath || "");
    const unitId = String(attemptData.unitId || "");
    const unitMeta = unitMetadata.get(unitId);

    if (!uid || !unitId || !unitMeta) {
      skippedMissingUnit += 1;
      continue;
    }

    const rawDetails = Array.isArray(attemptData.details) ? attemptData.details : [];
    const questionOrderMap = new Map(
      unitMeta.questions.map((question) => [question.questionId, question.questionOrder])
    );

    const questionResults = rawDetails
      .map((detail: any): AttemptBackfillQuestionResult | null => {
        const questionId = String(detail?.qId || detail?.questionId || "");
        if (!questionId) {
          return null;
        }

        return {
          questionId,
          questionOrder: Number(questionOrderMap.get(questionId) || 0),
          isCorrect: detail?.isCorrect === true,
        };
      })
      .filter((detail: AttemptBackfillQuestionResult | null): detail is AttemptBackfillQuestionResult => detail !== null);

    if (rawDetails.length > 0 && questionResults.length === 0) {
      skippedInvalid += 1;
      continue;
    }

    const occurredAt = attemptData.date
      ? admin.firestore.Timestamp.fromDate(new Date(attemptData.date))
      : attemptDoc.createTime || admin.firestore.Timestamp.now();

    const event = buildAttemptSubmittedEventFromAttempt({
      attemptId,
      uid,
      unitId,
      unitTitle: String(attemptData.unitTitle || unitMeta.unitTitle || unitId),
      subject: unitMeta.subject,
      category: unitMeta.category,
      occurredAt,
      score: toFiniteNumber(attemptData.score),
      timeSec: toFiniteNumber(attemptData.time),
      xpGain: toFiniteNumber(attemptData.xpGain),
      questionResults,
    });

    if (!dryRun) {
      writeBatch.set(db.collection("analytics_events").doc(eventDocId), event, { merge: true });
    }

    written += 1;
  }

  if (!dryRun && written > 0) {
    await writeBatch.commit();
  }

  const lastDoc = attemptsSnapshot.docs[attemptsSnapshot.docs.length - 1];

  return {
    ok: true,
    dryRun,
    processed: attemptsSnapshot.size,
    written,
    skippedExisting,
    skippedInvalid,
    skippedMissingUnit,
    hasMore: attemptsSnapshot.size === batchSize,
    nextCursor: lastDoc.ref.path,
  };
}

async function buildOverviewDoc(
  bigquery: BigQuery,
  config: AnalyticsConfig,
  userNames: Map<string, string>,
  unitMetadata: Map<string, UnitMetadata>,
  filter?: { field: "subject" | "category"; value: string }
) {
  const whereClause = scopedWhereClause(filter);
  const params = filter ? { scopeValue: filter.value } : undefined;
  const [totalsRow] = await runQuery(bigquery, config, `
SELECT
  COUNT(*) AS totalAttempts,
  COUNT(DISTINCT uid) AS uniqueUsers,
  SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS avgAccuracy,
  SUM(answered_count) AS totalAnswered,
  SUM(correct_count) AS totalCorrect,
  SUM(time_sec) AS totalStudyTimeSec,
  COUNT(DISTINCT IF(occurred_date = CURRENT_DATE('${config.timezone}'), uid, NULL)) AS dau,
  COUNT(DISTINCT IF(occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 6 DAY), uid, NULL)) AS wau,
  COUNT(DISTINCT IF(occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 29 DAY), uid, NULL)) AS mau,
  SAFE_DIVIDE(COUNT(*), NULLIF(COUNT(DISTINCT uid), 0)) AS avgAttemptsPerUser
FROM ${tableRef(config, "fact_attempts")}
${whereClause}
  `, params);

  const [qualityRow] = await runQuery(bigquery, config, `
WITH attempts AS (
  SELECT
    uid,
    unit_id,
    occurred_at,
    question_id,
    is_correct,
    ROW_NUMBER() OVER (
      PARTITION BY uid, unit_id, question_id
      ORDER BY occurred_at, attempt_id
    ) AS attempt_order
  FROM ${tableRef(config, "fact_attempt_question_results")}
  ${whereClause}
),
at_risk AS (
  SELECT
    uid,
    AVG(CAST(is_correct AS INT64)) * 100 AS accuracy,
    COUNT(*) AS answered_count
  FROM ${tableRef(config, "fact_attempt_question_results")}
  WHERE occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 14 DAY)
    ${filter ? `AND ${filter.field} = @scopeValue` : ""}
  GROUP BY uid
)
SELECT
  AVG(IF(attempt_order = 1, CAST(is_correct AS INT64), NULL)) * 100 AS firstAttemptAccuracy,
  (
    AVG(IF(attempt_order > 1, CAST(is_correct AS INT64), NULL)) -
    AVG(IF(attempt_order = 1, CAST(is_correct AS INT64), NULL))
  ) * 100 AS retryImprovementRate,
  (
    SELECT COUNTIF(answered_count >= 10 AND accuracy < 50)
    FROM at_risk
  ) AS atRiskUsers
FROM attempts
  `, params);

  const bySubject = await runQuery(bigquery, config, `
SELECT
  subject,
  COUNT(*) AS totalAttempts,
  SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS avgAccuracy
FROM ${tableRef(config, "fact_attempts")}
${whereClause}
GROUP BY subject
ORDER BY totalAttempts DESC
  `, params);

  const topAccuracyRows = await runQuery(bigquery, config, `
SELECT
  uid,
  SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS value,
  AVG(time_sec) AS avgTime,
  COUNT(*) AS attempts
FROM ${tableRef(config, "fact_attempts")}
${whereClause}
GROUP BY uid
HAVING attempts >= 3
ORDER BY value DESC, avgTime ASC
LIMIT 10
  `, params);

  const worstAccuracyRows = await runQuery(bigquery, config, `
SELECT
  uid,
  SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS value,
  AVG(time_sec) AS avgTime,
  COUNT(*) AS attempts
FROM ${tableRef(config, "fact_attempts")}
${whereClause}
GROUP BY uid
HAVING attempts >= 3
ORDER BY value ASC, avgTime DESC
LIMIT 10
  `, params);

  const topCorrectRows = await runQuery(bigquery, config, `
SELECT
  uid,
  SUM(correct_count) AS value,
  COUNT(*) AS attempts
FROM ${tableRef(config, "fact_attempts")}
${whereClause}
GROUP BY uid
ORDER BY value DESC, attempts DESC
LIMIT 10
  `, params);

  const worstCorrectRows = await runQuery(bigquery, config, `
SELECT
  uid,
  SUM(correct_count) AS value,
  COUNT(*) AS attempts
FROM ${tableRef(config, "fact_attempts")}
${whereClause}
GROUP BY uid
ORDER BY value ASC, attempts ASC
LIMIT 10
  `, params);

  const currentDate = new Date().toISOString().slice(0, 10);
  const earliestDateQuery = await runQuery(bigquery, config, `
SELECT
  MIN(CAST(occurred_date AS STRING)) AS startDate
FROM ${tableRef(config, "fact_attempts")}
${whereClause}
  `, params);

  return {
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    scope: filter
      ? {
          type: filter.field,
          value: filter.value,
          key: safeServingDocId(filter.value),
        }
      : { type: "global", value: "all", key: "current" },
    sourceWindow: {
      startDate: earliestDateQuery[0]?.startDate || currentDate,
      endDate: currentDate,
    },
    totals: {
      totalAttempts: Number(totalsRow?.totalAttempts || 0),
      uniqueUsers: Number(totalsRow?.uniqueUsers || 0),
      avgAccuracy: Number(totalsRow?.avgAccuracy || 0),
      totalAnswered: Number(totalsRow?.totalAnswered || 0),
      totalCorrect: Number(totalsRow?.totalCorrect || 0),
      totalStudyTimeSec: Number(totalsRow?.totalStudyTimeSec || 0),
      dau: Number(totalsRow?.dau || 0),
      wau: Number(totalsRow?.wau || 0),
      mau: Number(totalsRow?.mau || 0),
      avgAttemptsPerUser: Number(totalsRow?.avgAttemptsPerUser || 0),
      firstAttemptAccuracy: Number(qualityRow?.firstAttemptAccuracy || 0),
      retryImprovementRate: Number(qualityRow?.retryImprovementRate || 0),
      atRiskUsers: Number(qualityRow?.atRiskUsers || 0),
    },
    bySubject: bySubject.map((row) => ({
      subject: row.subject || "謨ｰ蟄ｦ",
      totalAttempts: Number(row.totalAttempts || 0),
      avgAccuracy: Number(row.avgAccuracy || 0),
    })),
    rankings: {
      topAccuracy: topAccuracyRows.map((row) => ({
        uid: row.uid,
        userName: userNames.get(row.uid) || row.uid,
        value: Number(row.value || 0),
        displayValue: `${Number(row.value || 0).toFixed(1)}%`,
        avgTime: Number(row.avgTime || 0),
        rankValue: `${Number(row.avgTime || 0).toFixed(0)}\u79d2`,
      })),
      worstAccuracy: worstAccuracyRows.map((row) => ({
        uid: row.uid,
        userName: userNames.get(row.uid) || row.uid,
        value: Number(row.value || 0),
        displayValue: `${Number(row.value || 0).toFixed(1)}%`,
        avgTime: Number(row.avgTime || 0),
        rankValue: `${Number(row.avgTime || 0).toFixed(0)}\u79d2`,
      })),
      topCorrect: topCorrectRows.map((row) => ({
        uid: row.uid,
        userName: userNames.get(row.uid) || row.uid,
        value: Number(row.value || 0),
        displayValue: `${Number(row.value || 0).toLocaleString()}\u554f`,
        rankValue: `${Number(row.attempts || 0)} attempt`,
      })),
      worstCorrect: worstCorrectRows.map((row) => ({
        uid: row.uid,
        userName: userNames.get(row.uid) || row.uid,
        value: Number(row.value || 0),
        displayValue: `${Number(row.value || 0).toLocaleString()}\u554f`,
        rankValue: `${Number(row.attempts || 0)} attempt`,
      })),
    },
    metadata: {
      unitsTracked: unitMetadata.size,
    },
  };
}

async function buildScopedOverviewDocs(
  bigquery: BigQuery,
  config: AnalyticsConfig,
  userNames: Map<string, string>,
  unitMetadata: Map<string, UnitMetadata>
) {
  const scopedFactAttempts = `
WITH scoped_attempts AS (
  SELECT
    'subject' AS scope_type,
    subject AS scope_value,
    *
  FROM ${tableRef(config, "fact_attempts")}
  WHERE subject IS NOT NULL AND subject != ''
  UNION ALL
  SELECT
    'category' AS scope_type,
    category AS scope_value,
    *
  FROM ${tableRef(config, "fact_attempts")}
  WHERE category IS NOT NULL AND category != ''
)`;

  const scopedQuestionResults = `
WITH scoped_questions AS (
  SELECT
    'subject' AS scope_type,
    subject AS scope_value,
    *
  FROM ${tableRef(config, "fact_attempt_question_results")}
  WHERE subject IS NOT NULL AND subject != ''
  UNION ALL
  SELECT
    'category' AS scope_type,
    category AS scope_value,
    *
  FROM ${tableRef(config, "fact_attempt_question_results")}
  WHERE category IS NOT NULL AND category != ''
)`;

  const [totalsRows, qualityRows, bySubjectRows, rankingRows] = await Promise.all([
    runQuery(bigquery, config, `
${scopedFactAttempts}
SELECT
  scope_type,
  scope_value,
  COUNT(*) AS totalAttempts,
  COUNT(DISTINCT uid) AS uniqueUsers,
  SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS avgAccuracy,
  SUM(answered_count) AS totalAnswered,
  SUM(correct_count) AS totalCorrect,
  SUM(time_sec) AS totalStudyTimeSec,
  COUNT(DISTINCT IF(occurred_date = CURRENT_DATE('${config.timezone}'), uid, NULL)) AS dau,
  COUNT(DISTINCT IF(occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 6 DAY), uid, NULL)) AS wau,
  COUNT(DISTINCT IF(occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 29 DAY), uid, NULL)) AS mau,
  SAFE_DIVIDE(COUNT(*), NULLIF(COUNT(DISTINCT uid), 0)) AS avgAttemptsPerUser,
  MIN(CAST(occurred_date AS STRING)) AS startDate
FROM scoped_attempts
GROUP BY scope_type, scope_value
ORDER BY scope_type, scope_value
    `),
    runQuery(bigquery, config, `
${scopedQuestionResults},
attempts AS (
  SELECT
    scope_type,
    scope_value,
    uid,
    unit_id,
    occurred_at,
    attempt_id,
    question_id,
    is_correct,
    ROW_NUMBER() OVER (
      PARTITION BY scope_type, scope_value, uid, unit_id, question_id
      ORDER BY occurred_at, attempt_id
    ) AS attempt_order
  FROM scoped_questions
),
quality AS (
  SELECT
    scope_type,
    scope_value,
    AVG(IF(attempt_order = 1, CAST(is_correct AS INT64), NULL)) * 100 AS firstAttemptAccuracy,
    (
      AVG(IF(attempt_order > 1, CAST(is_correct AS INT64), NULL)) -
      AVG(IF(attempt_order = 1, CAST(is_correct AS INT64), NULL))
    ) * 100 AS retryImprovementRate
  FROM attempts
  GROUP BY scope_type, scope_value
),
at_risk AS (
  SELECT
    scope_type,
    scope_value,
    uid,
    AVG(CAST(is_correct AS INT64)) * 100 AS accuracy,
    COUNT(*) AS answered_count
  FROM scoped_questions
  WHERE occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 14 DAY)
  GROUP BY scope_type, scope_value, uid
),
at_risk_counts AS (
  SELECT
    scope_type,
    scope_value,
    COUNTIF(answered_count >= 10 AND accuracy < 50) AS atRiskUsers
  FROM at_risk
  GROUP BY scope_type, scope_value
)
SELECT
  quality.scope_type,
  quality.scope_value,
  quality.firstAttemptAccuracy,
  quality.retryImprovementRate,
  COALESCE(at_risk_counts.atRiskUsers, 0) AS atRiskUsers
FROM quality
LEFT JOIN at_risk_counts
  ON at_risk_counts.scope_type = quality.scope_type
 AND at_risk_counts.scope_value = quality.scope_value
    `),
    runQuery(bigquery, config, `
${scopedFactAttempts}
SELECT
  scope_type,
  scope_value,
  subject,
  COUNT(*) AS totalAttempts,
  SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS avgAccuracy
FROM scoped_attempts
GROUP BY scope_type, scope_value, subject
ORDER BY scope_type, scope_value, totalAttempts DESC
    `),
    runQuery(bigquery, config, `
${scopedFactAttempts},
user_stats AS (
  SELECT
    scope_type,
    scope_value,
    uid,
    SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS accuracy,
    SUM(correct_count) AS correct_count,
    AVG(time_sec) AS avg_time_sec,
    COUNT(*) AS attempts
  FROM scoped_attempts
  GROUP BY scope_type, scope_value, uid
),
ranked AS (
  SELECT
    scope_type,
    scope_value,
    uid,
    accuracy AS value,
    avg_time_sec AS avgTime,
    attempts,
    'topAccuracy' AS rankKind,
    ROW_NUMBER() OVER (
      PARTITION BY scope_type, scope_value
      ORDER BY accuracy DESC, avg_time_sec ASC
    ) AS rank_num
  FROM user_stats
  WHERE attempts >= 3
  UNION ALL
  SELECT
    scope_type,
    scope_value,
    uid,
    accuracy AS value,
    avg_time_sec AS avgTime,
    attempts,
    'worstAccuracy' AS rankKind,
    ROW_NUMBER() OVER (
      PARTITION BY scope_type, scope_value
      ORDER BY accuracy ASC, avg_time_sec DESC
    ) AS rank_num
  FROM user_stats
  WHERE attempts >= 3
  UNION ALL
  SELECT
    scope_type,
    scope_value,
    uid,
    correct_count AS value,
    NULL AS avgTime,
    attempts,
    'topCorrect' AS rankKind,
    ROW_NUMBER() OVER (
      PARTITION BY scope_type, scope_value
      ORDER BY correct_count DESC, attempts DESC
    ) AS rank_num
  FROM user_stats
  UNION ALL
  SELECT
    scope_type,
    scope_value,
    uid,
    correct_count AS value,
    NULL AS avgTime,
    attempts,
    'worstCorrect' AS rankKind,
    ROW_NUMBER() OVER (
      PARTITION BY scope_type, scope_value
      ORDER BY correct_count ASC, attempts ASC
    ) AS rank_num
  FROM user_stats
)
SELECT *
FROM ranked
WHERE rank_num <= 10
ORDER BY scope_type, scope_value, rankKind, rank_num
    `),
  ]);

  const scopeKey = (scopeType: string, scopeValue: string) => `${scopeType}:${scopeValue}`;
  const currentDate = new Date().toISOString().slice(0, 10);
  const qualityByScope = new Map<string, any>();
  const bySubjectByScope = new Map<string, any[]>();
  const rankingsByScope = new Map<string, Record<string, any[]>>();

  for (const row of qualityRows) {
    qualityByScope.set(scopeKey(String(row.scope_type || ""), String(row.scope_value || "")), row);
  }

  for (const row of bySubjectRows) {
    const key = scopeKey(String(row.scope_type || ""), String(row.scope_value || ""));
    const rows = bySubjectByScope.get(key) || [];
    rows.push(row);
    bySubjectByScope.set(key, rows);
  }

  for (const row of rankingRows) {
    const key = scopeKey(String(row.scope_type || ""), String(row.scope_value || ""));
    const rankKind = String(row.rankKind || "");
    const grouped = rankingsByScope.get(key) || {};
    grouped[rankKind] = grouped[rankKind] || [];
    grouped[rankKind].push(row);
    rankingsByScope.set(key, grouped);
  }

  const toAccuracyRank = (row: any) => ({
    uid: row.uid,
    userName: userNames.get(row.uid) || row.uid,
    value: Number(row.value || 0),
    displayValue: `${Number(row.value || 0).toFixed(1)}%`,
    avgTime: Number(row.avgTime || 0),
    rankValue: `${Number(row.avgTime || 0).toFixed(0)}\u79d2`,
  });

  const toCorrectRank = (row: any) => ({
    uid: row.uid,
    userName: userNames.get(row.uid) || row.uid,
    value: Number(row.value || 0),
    displayValue: `${Number(row.value || 0).toLocaleString()}\u554f`,
    rankValue: `${Number(row.attempts || 0)} attempt`,
  });

  const bySubject = new Map<string, any>();
  const byCategory = new Map<string, any>();

  for (const row of totalsRows) {
    const scopeType = String(row.scope_type || "");
    const scopeValue = String(row.scope_value || "");
    if ((scopeType !== "subject" && scopeType !== "category") || !scopeValue) continue;

    const key = scopeKey(scopeType, scopeValue);
    const qualityRow = qualityByScope.get(key) || {};
    const groupedRankings = rankingsByScope.get(key) || {};
    const docData = {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      scope: {
        type: scopeType,
        value: scopeValue,
        key: safeServingDocId(scopeValue),
      },
      sourceWindow: {
        startDate: row.startDate || currentDate,
        endDate: currentDate,
      },
      totals: {
        totalAttempts: Number(row.totalAttempts || 0),
        uniqueUsers: Number(row.uniqueUsers || 0),
        avgAccuracy: Number(row.avgAccuracy || 0),
        totalAnswered: Number(row.totalAnswered || 0),
        totalCorrect: Number(row.totalCorrect || 0),
        totalStudyTimeSec: Number(row.totalStudyTimeSec || 0),
        dau: Number(row.dau || 0),
        wau: Number(row.wau || 0),
        mau: Number(row.mau || 0),
        avgAttemptsPerUser: Number(row.avgAttemptsPerUser || 0),
        firstAttemptAccuracy: Number(qualityRow.firstAttemptAccuracy || 0),
        retryImprovementRate: Number(qualityRow.retryImprovementRate || 0),
        atRiskUsers: Number(qualityRow.atRiskUsers || 0),
      },
      bySubject: (bySubjectByScope.get(key) || []).map((subjectRow) => ({
        subject: subjectRow.subject || "隰ｨ・ｰ陝・ｽｦ",
        totalAttempts: Number(subjectRow.totalAttempts || 0),
        avgAccuracy: Number(subjectRow.avgAccuracy || 0),
      })),
      rankings: {
        topAccuracy: (groupedRankings.topAccuracy || []).map(toAccuracyRank),
        worstAccuracy: (groupedRankings.worstAccuracy || []).map(toAccuracyRank),
        topCorrect: (groupedRankings.topCorrect || []).map(toCorrectRank),
        worstCorrect: (groupedRankings.worstCorrect || []).map(toCorrectRank),
      },
      metadata: {
        unitsTracked: unitMetadata.size,
        aggregationMode: "bulk_scoped_overview",
      },
    };

    if (scopeType === "subject") {
      bySubject.set(safeServingDocId(scopeValue), docData);
    } else {
      byCategory.set(safeServingDocId(scopeValue), docData);
    }
  }

  return { bySubject, byCategory };
}

async function buildUnitRankingDocs(
  bigquery: BigQuery,
  config: AnalyticsConfig,
  userNames: Map<string, string>
) {
  const rows = await runQuery(bigquery, config, `
SELECT
  unit_id,
  uid,
  SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS accuracy,
  SUM(correct_count) AS correct_count,
  AVG(time_sec) AS avg_time_sec,
  COUNT(*) AS attempts
FROM ${tableRef(config, "fact_attempts")}
GROUP BY unit_id, uid
HAVING attempts >= 1
ORDER BY unit_id, accuracy DESC, avg_time_sec ASC
  `);

  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    const unitId = String(row.unit_id || "");
    if (!unitId) continue;
    const list = grouped.get(unitId) || [];
    list.push(row);
    grouped.set(unitId, list);
  }

  const docs = new Map<string, any>();
  for (const [unitId, list] of grouped.entries()) {
    const byAccuracyDesc = [...list].sort((left, right) => {
      const accuracyDiff = Number(right.accuracy || 0) - Number(left.accuracy || 0);
      if (Math.abs(accuracyDiff) > 0.01) return accuracyDiff;
      return Number(left.avg_time_sec || 0) - Number(right.avg_time_sec || 0);
    });
    const byAccuracyAsc = [...list].sort((left, right) => {
      const accuracyDiff = Number(left.accuracy || 0) - Number(right.accuracy || 0);
      if (Math.abs(accuracyDiff) > 0.01) return accuracyDiff;
      return Number(right.avg_time_sec || 0) - Number(left.avg_time_sec || 0);
    });
    const byCorrectDesc = [...list].sort((left, right) => {
      const correctDiff = Number(right.correct_count || 0) - Number(left.correct_count || 0);
      if (correctDiff !== 0) return correctDiff;
      return Number(right.attempts || 0) - Number(left.attempts || 0);
    });
    const byCorrectAsc = [...list].sort((left, right) => {
      const correctDiff = Number(left.correct_count || 0) - Number(right.correct_count || 0);
      if (correctDiff !== 0) return correctDiff;
      return Number(left.attempts || 0) - Number(right.attempts || 0);
    });

    const toAccuracyRank = (row: any) => ({
      uid: row.uid,
      userName: userNames.get(row.uid) || row.uid,
      value: Number(row.accuracy || 0),
      displayValue: `${Number(row.accuracy || 0).toFixed(1)}%`,
      avgTime: Number(row.avg_time_sec || 0),
      rankValue: `${Number(row.avg_time_sec || 0).toFixed(0)}\u79d2`,
    });
    const toCorrectRank = (row: any) => ({
      uid: row.uid,
      userName: userNames.get(row.uid) || row.uid,
      value: Number(row.correct_count || 0),
      displayValue: `${Number(row.correct_count || 0).toLocaleString()}\u554f`,
      rankValue: `${Number(row.attempts || 0)} attempt`,
    });

    docs.set(unitId, {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      unitId,
      minAttempts: 1,
      rankings: {
        topAccuracy: byAccuracyDesc.slice(0, 10).map(toAccuracyRank),
        worstAccuracy: byAccuracyAsc.slice(0, 10).map(toAccuracyRank),
        topCorrect: byCorrectDesc.slice(0, 10).map(toCorrectRank),
        worstCorrect: byCorrectAsc.slice(0, 10).map(toCorrectRank),
      },
    });
  }

  return docs;
}

async function buildPublicReportDocs(
  bigquery: BigQuery,
  config: AnalyticsConfig,
  metadata: Map<string, UnitMetadata>
) {
  const [overviewRow] = await runQuery(bigquery, config, `
SELECT
  COUNT(*) AS total_attempts,
  COUNT(DISTINCT uid) AS unique_users,
  SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS avg_accuracy,
  SUM(answered_count) AS total_answered,
  SUM(correct_count) AS total_correct,
  SUM(time_sec) AS total_study_time_sec,
  COUNT(DISTINCT IF(occurred_date = CURRENT_DATE('${config.timezone}'), uid, NULL)) AS dau,
  COUNT(DISTINCT IF(occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 6 DAY), uid, NULL)) AS wau,
  COUNT(DISTINCT IF(occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 29 DAY), uid, NULL)) AS mau
FROM ${tableRef(config, "fact_attempts")}
  `);

  const insightRows = await runQuery(bigquery, config, `
WITH scoped_questions AS (
  SELECT
    'all' AS scope_type,
    'all' AS scope_value,
    *
  FROM ${tableRef(config, "fact_attempt_question_results")}
  UNION ALL
  SELECT
    'category' AS scope_type,
    category AS scope_value,
    *
  FROM ${tableRef(config, "fact_attempt_question_results")}
  WHERE category IS NOT NULL AND category != ''
),
ordered_questions AS (
  SELECT
    scope_type,
    scope_value,
    uid,
    unit_id,
    question_id,
    is_correct,
    ROW_NUMBER() OVER (
      PARTITION BY scope_type, scope_value, uid, unit_id, question_id
      ORDER BY occurred_at, attempt_id
    ) AS attempt_order
  FROM scoped_questions
),
quality AS (
  SELECT
    scope_type,
    scope_value,
    AVG(IF(attempt_order = 1, CAST(is_correct AS INT64), NULL)) * 100 AS first_attempt_accuracy,
    (
      AVG(IF(attempt_order > 1, CAST(is_correct AS INT64), NULL)) -
      AVG(IF(attempt_order = 1, CAST(is_correct AS INT64), NULL))
    ) * 100 AS retry_improvement_rate
  FROM ordered_questions
  GROUP BY scope_type, scope_value
),
question_stats AS (
  SELECT
    scope_type,
    scope_value,
    unit_id,
    question_id,
    COUNT(*) AS total,
    COUNT(DISTINCT uid) AS unique_users,
    AVG(CAST(is_correct AS INT64)) * 100 AS accuracy
  FROM scoped_questions
  GROUP BY scope_type, scope_value, unit_id, question_id
),
persistent AS (
  SELECT
    scope_type,
    scope_value,
    COUNTIF(
      total >= ${PUBLIC_REPORT_THRESHOLDS.questionMinAttempts}
      AND unique_users >= ${PUBLIC_REPORT_THRESHOLDS.questionMinUsers}
      AND accuracy < 60
    ) AS persistent_struggle_questions
  FROM question_stats
  GROUP BY scope_type, scope_value
)
SELECT
  quality.scope_type,
  quality.scope_value,
  100 - COALESCE(quality.first_attempt_accuracy, 0) AS initial_stumble_rate,
  COALESCE(quality.retry_improvement_rate, 0) AS retry_improvement_rate,
  COALESCE(persistent.persistent_struggle_questions, 0) AS persistent_struggle_questions
FROM quality
LEFT JOIN persistent
  ON persistent.scope_type = quality.scope_type
 AND persistent.scope_value = quality.scope_value
  `);

  const unitRows = await runQuery(bigquery, config, `
WITH unit_question_attempts AS (
  SELECT
    unit_id,
    uid,
    question_id,
    is_correct,
    ROW_NUMBER() OVER (
      PARTITION BY uid, unit_id, question_id
      ORDER BY occurred_at, attempt_id
    ) AS question_attempt_order
  FROM ${tableRef(config, "fact_attempt_question_results")}
),
first_retry AS (
  SELECT
    unit_id,
    AVG(IF(question_attempt_order = 1, CAST(is_correct AS INT64), NULL)) * 100 AS first_attempt_accuracy,
    (
      AVG(IF(question_attempt_order > 1, CAST(is_correct AS INT64), NULL)) -
      AVG(IF(question_attempt_order = 1, CAST(is_correct AS INT64), NULL))
    ) * 100 AS retry_improvement_rate
  FROM unit_question_attempts
  GROUP BY unit_id
)
SELECT
  attempts.unit_id,
  ANY_VALUE(attempts.unit_title) AS unit_title,
  ANY_VALUE(attempts.subject) AS subject,
  ANY_VALUE(attempts.category) AS category,
  COUNT(*) AS total_attempts,
  COUNT(DISTINCT attempts.uid) AS unique_users,
  SUM(attempts.answered_count) AS total_answered,
  SUM(attempts.correct_count) AS total_correct,
  SAFE_DIVIDE(SUM(attempts.correct_count), NULLIF(SUM(attempts.answered_count), 0)) * 100 AS avg_accuracy,
  AVG(attempts.time_sec) AS avg_time_sec,
  COALESCE(ANY_VALUE(fr.first_attempt_accuracy), 0) AS first_attempt_accuracy,
  COALESCE(ANY_VALUE(fr.retry_improvement_rate), 0) AS retry_improvement_rate,
  (100 - SAFE_DIVIDE(SUM(attempts.correct_count), NULLIF(SUM(attempts.answered_count), 0)) * 100)
    * LOG10(COUNT(*) + 10) AS improvement_priority_score
FROM ${tableRef(config, "fact_attempts")} attempts
LEFT JOIN first_retry fr
  ON fr.unit_id = attempts.unit_id
GROUP BY attempts.unit_id
HAVING unique_users >= ${PUBLIC_REPORT_THRESHOLDS.unitMinUsers}
ORDER BY improvement_priority_score DESC
  `);

  const questionRows = await runQuery(bigquery, config, `
SELECT
  unit_id,
  question_id,
  ANY_VALUE(question_order) AS question_order,
  COUNT(*) AS total,
  COUNT(DISTINCT uid) AS unique_users,
  SUM(CAST(is_correct AS INT64)) AS correct,
  SAFE_DIVIDE(SUM(CAST(is_correct AS INT64)), NULLIF(COUNT(*), 0)) * 100 AS accuracy
FROM ${tableRef(config, "fact_attempt_question_results")}
GROUP BY unit_id, question_id
HAVING total >= ${PUBLIC_REPORT_THRESHOLDS.questionMinAttempts}
  AND unique_users >= ${PUBLIC_REPORT_THRESHOLDS.questionMinUsers}
ORDER BY unit_id, accuracy ASC, total DESC
  `);

  const quartileRows = await runQuery(bigquery, config, `
WITH scoped_questions AS (
  SELECT
    'all' AS scope_type,
    'all' AS scope_value,
    *
  FROM ${tableRef(config, "fact_attempt_question_results")}
  UNION ALL
  SELECT
    'category' AS scope_type,
    category AS scope_value,
    *
  FROM ${tableRef(config, "fact_attempt_question_results")}
  WHERE category IS NOT NULL AND category != ''
),
user_question AS (
  SELECT
    scope_type,
    scope_value,
    unit_id,
    question_id,
    uid,
    COUNT(*) AS attempts,
    AVG(CAST(is_correct AS INT64)) * 100 AS user_accuracy
  FROM scoped_questions
  GROUP BY scope_type, scope_value, unit_id, question_id, uid
),
question_distribution AS (
  SELECT
    scope_type,
    scope_value,
    unit_id,
    question_id,
    COUNT(*) AS unique_users,
    SUM(attempts) AS total,
    AVG(user_accuracy) AS accuracy,
    APPROX_QUANTILES(user_accuracy, 4)[OFFSET(1)] AS q1_accuracy,
    APPROX_QUANTILES(user_accuracy, 4)[OFFSET(3)] AS q3_accuracy
  FROM user_question
  GROUP BY scope_type, scope_value, unit_id, question_id
)
SELECT
  scope_type,
  scope_value,
  unit_id,
  question_id,
  unique_users,
  total,
  accuracy,
  q1_accuracy,
  q3_accuracy,
  q3_accuracy - q1_accuracy AS iqr
FROM question_distribution
WHERE unique_users >= ${PUBLIC_REPORT_THRESHOLDS.questionMinUsers}
  AND total >= ${PUBLIC_REPORT_THRESHOLDS.questionMinAttempts}
ORDER BY scope_type, scope_value, iqr DESC, total DESC
  `);

  const correlationRows = await runQuery(bigquery, config, `
SELECT
  unit_id,
  question_id_a,
  question_id_b,
  support_users,
  co_wrong_users,
  mistake_rate_given_a,
  mistake_rate_given_b
FROM ${tableRef(config, "agg_question_pair_current")}
WHERE support_users >= ${PUBLIC_REPORT_THRESHOLDS.correlationMinSupportUsers}
  AND co_wrong_users >= ${PUBLIC_REPORT_THRESHOLDS.correlationMinCoWrongUsers}
ORDER BY unit_id, co_wrong_users DESC, GREATEST(mistake_rate_given_a, mistake_rate_given_b) DESC
  `);

  const trendRows = await runQuery(bigquery, config, `
SELECT
  occurred_date AS date,
  COUNT(*) AS total_attempts,
  COUNT(DISTINCT uid) AS unique_users,
  SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS avg_accuracy,
  SUM(time_sec) AS study_time_sec
FROM ${tableRef(config, "fact_attempts")}
WHERE occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 29 DAY)
GROUP BY occurred_date
HAVING unique_users >= ${PUBLIC_REPORT_THRESHOLDS.unitMinUsers}
ORDER BY occurred_date
  `);

  const categoryRows = await runQuery(bigquery, config, `
SELECT
  category,
  COUNT(*) AS total_attempts,
  COUNT(DISTINCT uid) AS unique_users,
  SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS avg_accuracy,
  SUM(answered_count) AS total_answered,
  SUM(correct_count) AS total_correct,
  SUM(time_sec) AS total_study_time_sec,
  COUNT(DISTINCT IF(occurred_date = CURRENT_DATE('${config.timezone}'), uid, NULL)) AS dau,
  COUNT(DISTINCT IF(occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 6 DAY), uid, NULL)) AS wau,
  COUNT(DISTINCT IF(occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 29 DAY), uid, NULL)) AS mau,
  COUNT(DISTINCT unit_id) AS unit_count
FROM ${tableRef(config, "fact_attempts")}
WHERE category IS NOT NULL AND category != ''
GROUP BY category
HAVING unique_users >= ${PUBLIC_REPORT_THRESHOLDS.unitMinUsers}
ORDER BY total_attempts DESC
  `);

  const categoryTrendRows = await runQuery(bigquery, config, `
SELECT
  category,
  occurred_date AS date,
  COUNT(*) AS total_attempts,
  COUNT(DISTINCT uid) AS unique_users,
  SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS avg_accuracy,
  SUM(time_sec) AS study_time_sec
FROM ${tableRef(config, "fact_attempts")}
WHERE occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 29 DAY)
  AND category IS NOT NULL AND category != ''
GROUP BY category, occurred_date
HAVING unique_users >= ${PUBLIC_REPORT_THRESHOLDS.unitMinUsers}
ORDER BY category, occurred_date
  `);

  const questionMap = new Map<string, any[]>();
  for (const row of questionRows) {
    const unitId = String(row.unit_id || "");
    if (!unitId) continue;
    const unitMeta = metadata.get(unitId);
    const questionMeta = unitMeta?.questions.find((question) => question.questionId === row.question_id);
    const list = questionMap.get(unitId) || [];
    list.push({
      questionId: row.question_id,
      questionOrder: Number(row.question_order || questionMeta?.questionOrder || 0),
      questionText: questionMeta?.questionText || row.question_id,
      total: Number(row.total || 0),
      uniqueUsers: Number(row.unique_users || 0),
      accuracy: Number(row.accuracy || 0),
      stumbleRate: 100 - Number(row.accuracy || 0),
    });
    questionMap.set(unitId, list);
  }

  const correlationMap = new Map<string, any[]>();
  for (const row of correlationRows) {
    const unitId = String(row.unit_id || "");
    if (!unitId) continue;
    const unitMeta = metadata.get(unitId);
    const questionA = unitMeta?.questions.find((question) => question.questionId === row.question_id_a);
    const questionB = unitMeta?.questions.find((question) => question.questionId === row.question_id_b);
    const list = correlationMap.get(unitId) || [];
    list.push({
      questionIdA: row.question_id_a,
      questionIdB: row.question_id_b,
      questionTextA: questionA?.questionText || row.question_id_a,
      questionTextB: questionB?.questionText || row.question_id_b,
      supportUsers: Number(row.support_users || 0),
      coWrongUsers: Number(row.co_wrong_users || 0),
      mistakeRateGivenA: Number(row.mistake_rate_given_a || 0),
      mistakeRateGivenB: Number(row.mistake_rate_given_b || 0),
    });
    correlationMap.set(unitId, list);
  }

  const reportUnits = unitRows.map((row) => {
    const unitId = String(row.unit_id || "");
    const unitMeta = metadata.get(unitId);
    const questions = questionMap.get(unitId) || [];
    return {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      unitId,
      unitTitle: unitMeta?.unitTitle || row.unit_title || unitId,
      subject: unitMeta?.subject || row.subject || "謨ｰ蟄ｦ",
      category: unitMeta?.category || "\u305d\u306e\u4ed6",
      totals: {
        totalAttempts: Number(row.total_attempts || 0),
        uniqueUsers: Number(row.unique_users || 0),
        avgAccuracy: Number(row.avg_accuracy || 0),
        avgTimeSec: Number(row.avg_time_sec || 0),
        firstAttemptAccuracy: Number(row.first_attempt_accuracy || 0),
        retryImprovementRate: Number(row.retry_improvement_rate || 0),
        improvementPriorityScore: Number(row.improvement_priority_score || 0),
      },
      reviewQuestions: questions.slice(0, 5),
      strongCoMistakes: (correlationMap.get(unitId) || []).slice(0, 5),
    };
  });

  const categoryTrendMap = new Map<string, any[]>();
  for (const row of categoryTrendRows) {
    const category = String(row.category || "");
    if (!category) continue;
    const categoryKey = safeServingDocId(category);
    const list = categoryTrendMap.get(categoryKey) || [];
    list.push({
      date: String(row.date?.value || row.date || ""),
      totalAttempts: Number(row.total_attempts || 0),
      uniqueUsers: Number(row.unique_users || 0),
      avgAccuracy: Number(row.avg_accuracy || 0),
      studyTimeSec: Number(row.study_time_sec || 0),
    });
    categoryTrendMap.set(categoryKey, list);
  }

  const quartileMap = new Map<string, { wide: any[]; narrow: any[] }>();
  const quartileCandidates = quartileRows
    .map((row) => {
      const unitId = String(row.unit_id || "");
      const unitMeta = metadata.get(unitId);
      const questionMeta = unitMeta?.questions.find((question) => question.questionId === row.question_id);
      const scopeType = String(row.scope_type || "");
      const scopeValue = String(row.scope_value || "");
      const key = scopeType === "category" ? safeServingDocId(scopeValue) : "all";
      return {
        key,
        unitId,
        unitTitle: unitMeta?.unitTitle || unitId,
        questionId: String(row.question_id || ""),
        questionOrder: Number(questionMeta?.questionOrder || 0),
        questionText: questionMeta?.questionText || String(row.question_id || ""),
        category: unitMeta?.category || scopeValue,
        total: Number(row.total || 0),
        uniqueUsers: Number(row.unique_users || 0),
        accuracy: Number(row.accuracy || 0),
        q1Accuracy: Number(row.q1_accuracy || 0),
        q3Accuracy: Number(row.q3_accuracy || 0),
        iqr: Number(row.iqr || 0),
      };
    })
    .filter((question) => question.unitId && question.questionId);

  const quartileKeys = new Set(quartileCandidates.map((question) => question.key));
  for (const key of quartileKeys) {
    const scoped = quartileCandidates.filter((question) => question.key === key);
    const stripKey = ({ key: _key, ...question }: any) => question;
    quartileMap.set(key, {
      wide: [...scoped]
        .sort((left, right) => right.iqr - left.iqr || right.total - left.total)
        .slice(0, 3)
        .map(stripKey),
      narrow: [...scoped]
        .sort((left, right) => left.iqr - right.iqr || right.total - left.total)
        .slice(0, 3)
        .map(stripKey),
    });
  }

  const coMistakePairCounts = new Map<string, number>();
  coMistakePairCounts.set("all", correlationRows.length);
  for (const row of correlationRows) {
    const unitMeta = metadata.get(String(row.unit_id || ""));
    const category = unitMeta?.category || String(row.category || "");
    if (!category) continue;
    const categoryKey = safeServingDocId(category);
    coMistakePairCounts.set(categoryKey, (coMistakePairCounts.get(categoryKey) || 0) + 1);
  }

  const insightMap = new Map<string, any>();
  for (const row of insightRows) {
    const scopeType = String(row.scope_type || "");
    const scopeValue = String(row.scope_value || "");
    const key = scopeType === "category" ? safeServingDocId(scopeValue) : "all";
    insightMap.set(key, {
      initialStumbleRate: Number(row.initial_stumble_rate || 0),
      retryImprovementRate: Number(row.retry_improvement_rate || 0),
      persistentStruggleQuestions: Number(row.persistent_struggle_questions || 0),
      coMistakePairs: Number(coMistakePairCounts.get(key) || 0),
      quartileQuestions: quartileMap.get(key) || { wide: [], narrow: [] },
    });
  }

  const reportCategories = categoryRows.map((row) => {
    const category = String(row.category || "Other");
    const categoryKey = safeServingDocId(category);
    return {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      category,
      categoryKey,
      totals: {
        totalAttempts: Number(row.total_attempts || 0),
        uniqueUsers: Number(row.unique_users || 0),
        avgAccuracy: Number(row.avg_accuracy || 0),
        totalAnswered: Number(row.total_answered || 0),
        totalCorrect: Number(row.total_correct || 0),
        totalStudyTimeSec: Number(row.total_study_time_sec || 0),
        dau: Number(row.dau || 0),
        wau: Number(row.wau || 0),
        mau: Number(row.mau || 0),
        unitCount: Number(row.unit_count || 0),
      },
      insights: insightMap.get(categoryKey) || {
        initialStumbleRate: 0,
        retryImprovementRate: 0,
        persistentStruggleQuestions: 0,
        coMistakePairs: Number(coMistakePairCounts.get(categoryKey) || 0),
        quartileQuestions: quartileMap.get(categoryKey) || { wide: [], narrow: [] },
      },
      trends: {
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        days: categoryTrendMap.get(categoryKey) || [],
      },
    };
  });

  const overviewTotals = {
    totalAttempts: Number(overviewRow?.total_attempts || 0),
    uniqueUsers: Number(overviewRow?.unique_users || 0),
    avgAccuracy: Number(overviewRow?.avg_accuracy || 0),
    totalAnswered: Number(overviewRow?.total_answered || 0),
    totalCorrect: Number(overviewRow?.total_correct || 0),
    totalStudyTimeSec: Number(overviewRow?.total_study_time_sec || 0),
    dau: Number(overviewRow?.dau || 0),
    wau: Number(overviewRow?.wau || 0),
    mau: Number(overviewRow?.mau || 0),
  };
  const reportPublishable = overviewTotals.uniqueUsers >= PUBLIC_REPORT_THRESHOLDS.unitMinUsers;

  return {
    overview: {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      privacy: {
        pii: false,
        publishable: reportPublishable,
        suppressedReason: reportPublishable ? null : "insufficient_unique_users",
        thresholds: PUBLIC_REPORT_THRESHOLDS,
        suppressedLowSupportRows: true,
      },
      totals: reportPublishable ? overviewTotals : {
        totalAttempts: 0,
        uniqueUsers: 0,
        avgAccuracy: 0,
        totalAnswered: 0,
        totalCorrect: 0,
        totalStudyTimeSec: 0,
        dau: 0,
        wau: 0,
        mau: 0,
      },
      insights: reportPublishable ? insightMap.get("all") || {
        initialStumbleRate: 0,
        retryImprovementRate: 0,
        persistentStruggleQuestions: 0,
        coMistakePairs: Number(coMistakePairCounts.get("all") || 0),
        quartileQuestions: quartileMap.get("all") || { wide: [], narrow: [] },
      } : {
        initialStumbleRate: 0,
        retryImprovementRate: 0,
        persistentStruggleQuestions: 0,
        coMistakePairs: 0,
        quartileQuestions: { wide: [], narrow: [] },
      },
    },
    categories: reportCategories,
    units: reportUnits,
    trends: {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      days: trendRows.map((row) => ({
        date: String(row.date?.value || row.date || ""),
        totalAttempts: Number(row.total_attempts || 0),
        uniqueUsers: Number(row.unique_users || 0),
        avgAccuracy: Number(row.avg_accuracy || 0),
        studyTimeSec: Number(row.study_time_sec || 0),
      })),
    },
  };
}

async function buildUnitSummaries(
  bigquery: BigQuery,
  config: AnalyticsConfig,
  metadata: Map<string, UnitMetadata>
) {
  const rows = await runQuery(bigquery, config, `
SELECT
  unit_id,
  ANY_VALUE(unit_title) AS unit_title,
  ANY_VALUE(subject) AS subject,
  ANY_VALUE(category) AS category,
  SUM(total_attempts) AS total_attempts,
  SUM(unique_users) AS unique_users,
  SAFE_DIVIDE(SUM(total_correct), NULLIF(SUM(total_answered), 0)) * 100 AS avg_accuracy,
  AVG(avg_time_sec) AS avg_time_sec,
  AVG(first_attempt_accuracy) AS first_attempt_accuracy,
  AVG(retry_improvement_rate) AS retry_improvement_rate,
  AVG(improvement_priority_score) AS improvement_priority_score
FROM ${tableRef(config, "agg_unit_daily")}
GROUP BY unit_id
ORDER BY total_attempts DESC
  `);

  const questionRows = await runQuery(bigquery, config, `
SELECT
  unit_id,
  question_id,
  SUM(total) AS total,
  SUM(correct) AS correct,
  SAFE_DIVIDE(SUM(correct), NULLIF(SUM(total), 0)) * 100 AS accuracy
FROM ${tableRef(config, "agg_question_daily")}
GROUP BY unit_id, question_id
  `);

  const questionMap = new Map<string, any[]>();
  for (const row of questionRows) {
    const unitId = row.unit_id;
    const list = questionMap.get(unitId) || [];
    list.push(row);
    questionMap.set(unitId, list);
  }

  return rows.map((row) => {
    const unitId = row.unit_id as string;
    const unitMeta = metadata.get(unitId);
    const questions = (questionMap.get(unitId) || []).map((questionRow) => {
      const questionMeta = unitMeta?.questions.find((question) => question.questionId === questionRow.question_id);
      return {
        questionId: questionRow.question_id,
        questionText: questionMeta?.questionText || questionRow.question_id,
        accuracy: Number(questionRow.accuracy || 0),
        total: Number(questionRow.total || 0),
      };
    });

    const hardestQuestions = [...questions]
      .filter((question) => question.total > 0)
      .sort((left, right) => left.accuracy - right.accuracy)
      .slice(0, 5);

    const easiestQuestions = [...questions]
      .filter((question) => question.total > 0)
      .sort((left, right) => right.accuracy - left.accuracy)
      .slice(0, 5);

    return {
      unitId,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      unitTitle: unitMeta?.unitTitle || row.unit_title || unitId,
      subject: unitMeta?.subject || row.subject || "謨ｰ蟄ｦ",
      category: unitMeta?.category || "\u305d\u306e\u4ed6",
      totals: {
        totalAttempts: Number(row.total_attempts || 0),
        uniqueUsers: Number(row.unique_users || 0),
        avgAccuracy: Number(row.avg_accuracy || 0),
        avgTimeSec: Number(row.avg_time_sec || 0),
        firstAttemptAccuracy: Number(row.first_attempt_accuracy || 0),
        retryImprovementRate: Number(row.retry_improvement_rate || 0),
        improvementPriorityScore: Number(row.improvement_priority_score || 0),
      },
      hardestQuestions,
      easiestQuestions,
    };
  });
}

async function buildQuestionAnalysisDocs(
  bigquery: BigQuery,
  config: AnalyticsConfig,
  metadata: Map<string, UnitMetadata>
) {
  const rows = await runQuery(bigquery, config, `
SELECT
  unit_id,
  question_id,
  ANY_VALUE(question_order) AS question_order,
  SUM(total) AS total,
  SUM(correct) AS correct,
  SAFE_DIVIDE(SUM(correct), NULLIF(SUM(total), 0)) * 100 AS accuracy,
  AVG(first_attempt_accuracy) AS first_attempt_accuracy,
  AVG(retry_improvement_rate) AS retry_improvement_rate,
  AVG(avg_time_sec) AS avg_time_sec,
  AVG(discrimination_index) AS discrimination_index,
  AVG(improvement_priority_score) AS improvement_priority_score
FROM ${tableRef(config, "agg_question_daily")}
GROUP BY unit_id, question_id
ORDER BY unit_id, question_order
  `);

  const docs = new Map<string, any[]>();

  for (const row of rows) {
    const unitId = row.unit_id as string;
    const unitMeta = metadata.get(unitId);
    const questionMeta = unitMeta?.questions.find((question) => question.questionId === row.question_id);
    const list = docs.get(unitId) || [];

    const accuracy = Number(row.accuracy || 0);
    list.push({
      questionId: row.question_id,
      questionOrder: Number(row.question_order || questionMeta?.questionOrder || 0),
      questionText: questionMeta?.questionText || row.question_id,
      total: Number(row.total || 0),
      correct: Number(row.correct || 0),
      accuracy,
      difficulty:
        accuracy >= 90 ? "very_easy" :
        accuracy >= 70 ? "easy" :
        accuracy >= 40 ? "normal" :
        accuracy >= 20 ? "hard" :
        "very_hard",
      firstAttemptAccuracy: Number(row.first_attempt_accuracy || 0),
      retryImprovementRate: Number(row.retry_improvement_rate || 0),
      avgTimeSec: Number(row.avg_time_sec || 0),
      discriminationIndex: Number(row.discrimination_index || 0),
      improvementPriorityScore: Number(row.improvement_priority_score || 0),
    });

    docs.set(unitId, list);
  }

  return docs;
}

async function buildCorrelationDocs(
  bigquery: BigQuery,
  config: AnalyticsConfig,
  metadata: Map<string, UnitMetadata>
) {
  const rows = await runQuery(bigquery, config, `
SELECT
  unit_id,
  question_id_a,
  question_id_b,
  support_users,
  co_wrong_users,
  wrong_users_a,
  wrong_users_b,
  mistake_rate_given_a,
  mistake_rate_given_b,
  lift,
  phi,
  direction,
  strength
FROM ${tableRef(config, "agg_question_pair_current")}
ORDER BY unit_id, co_wrong_users DESC, GREATEST(mistake_rate_given_a, mistake_rate_given_b) DESC, phi DESC
  `);

  const docs = new Map<string, any[]>();

  for (const row of rows) {
    const unitId = row.unit_id as string;
    const unitMeta = metadata.get(unitId);
    const questionA = unitMeta?.questions.find((question) => question.questionId === row.question_id_a);
    const questionB = unitMeta?.questions.find((question) => question.questionId === row.question_id_b);
    const list = docs.get(unitId) || [];

    list.push({
      questionIdA: row.question_id_a,
      questionIdB: row.question_id_b,
      questionTextA: questionA?.questionText || row.question_id_a,
      questionTextB: questionB?.questionText || row.question_id_b,
      phi: Number(row.phi || 0),
      supportUsers: Number(row.support_users || 0),
      coWrongUsers: Number(row.co_wrong_users || 0),
      wrongUsersA: Number(row.wrong_users_a || 0),
      wrongUsersB: Number(row.wrong_users_b || 0),
      mistakeRateGivenA: Number(row.mistake_rate_given_a || 0),
      mistakeRateGivenB: Number(row.mistake_rate_given_b || 0),
      lift: Number(row.lift || 0),
      direction: row.direction || "positive",
      strength: row.strength || "moderate",
    });

    docs.set(unitId, list);
  }

  return docs;
}

async function writeServingDocs(
  config: AnalyticsConfig,
  overviewDoc: any,
  scopedOverviewDocs: {
    bySubject: Map<string, any>;
    byCategory: Map<string, any>;
  },
  unitSummaries: any[],
  questionAnalysisDocs: Map<string, any[]>,
  correlationDocs: Map<string, any[]>,
  unitRankingDocs: Map<string, any>,
  publicReportDocs: {
    overview: any;
    categories: any[];
    units: any[];
    trends: any;
  }
) {
  const root = config.servingRoot;
  let batch = db.batch();
  let writeCount = 0;

  const commitBatch = async () => {
    if (writeCount === 0) return;
    await batch.commit();
    batch = db.batch();
    writeCount = 0;
  };

  const setDoc = async (path: string, data: FirebaseFirestore.DocumentData) => {
    batch.set(db.doc(path), data, { merge: true });
    writeCount += 1;

    if (writeCount >= 450) {
      await commitBatch();
    }
  };

  await setDoc(`${root}/overview/current`, overviewDoc);
  await setDoc(
    `${root}/manifest/current`,
    {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      version: 1,
      overviewPath: `${root}/overview/current`,
      overviewBySubjectCollection: `${root}/overview_by_subject`,
      overviewByCategoryCollection: `${root}/overview_by_category`,
      unitSummaryCollection: `${root}/unit_summaries`,
      questionAnalysisCollection: `${root}/question_analysis`,
      questionCorrelationCollection: `${root}/question_correlations`,
      unitRankingCollection: `${root}/unit_rankings`,
    }
  );

  for (const [subjectKey, docData] of scopedOverviewDocs.bySubject.entries()) {
    await setDoc(`${root}/overview_by_subject/${subjectKey}`, docData);
  }

  for (const [categoryKey, docData] of scopedOverviewDocs.byCategory.entries()) {
    await setDoc(`${root}/overview_by_category/${categoryKey}`, docData);
  }

  for (const summary of unitSummaries) {
    await setDoc(`${root}/unit_summaries/${summary.unitId}`, summary);
  }

  for (const [unitId, rankingDoc] of unitRankingDocs.entries()) {
    await setDoc(`${root}/unit_rankings/${unitId}`, rankingDoc);
  }

  for (const [unitId, questions] of questionAnalysisDocs.entries()) {
    await setDoc(
      `${root}/question_analysis/${unitId}`,
      {
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        unitId,
        questions,
      }
    );
  }

  for (const [unitId, pairs] of correlationDocs.entries()) {
    await setDoc(
      `${root}/question_correlations/${unitId}`,
      {
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        unitId,
        minSupportUsers: 5,
        minCoWrongUsers: 3,
        pairs: pairs.slice(0, 100),
      }
    );
  }

  await setDoc(
    `${root}/job_status/daily`,
    {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "success",
      pipelineVersion: 1,
    }
  );

  await setDoc(`${PUBLIC_REPORT_ROOT}/report_overview/current`, publicReportDocs.overview);
  await setDoc(`${PUBLIC_REPORT_ROOT}/report_trends/current`, publicReportDocs.trends);
  await setDoc(
    `${PUBLIC_REPORT_ROOT}/manifest/current`,
    {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      version: 1,
      reportOverviewPath: `${PUBLIC_REPORT_ROOT}/report_overview/current`,
      reportCategoryCollection: `${PUBLIC_REPORT_ROOT}/report_categories`,
      reportCategoryTrendCollection: `${PUBLIC_REPORT_ROOT}/report_category_trends`,
      reportUnitCollection: `${PUBLIC_REPORT_ROOT}/report_units`,
      reportTrendPath: `${PUBLIC_REPORT_ROOT}/report_trends/current`,
      thresholds: PUBLIC_REPORT_THRESHOLDS,
    }
  );

  for (const categoryReport of publicReportDocs.categories) {
    await setDoc(`${PUBLIC_REPORT_ROOT}/report_categories/${categoryReport.categoryKey}`, categoryReport);
    await setDoc(`${PUBLIC_REPORT_ROOT}/report_category_trends/${categoryReport.categoryKey}`, categoryReport.trends || {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      days: [],
    });
  }

  for (const unitReport of publicReportDocs.units) {
    await setDoc(`${PUBLIC_REPORT_ROOT}/report_units/${unitReport.unitId}`, unitReport);
  }

  await commitBatch();
}

async function runAnalyticsAggregationInternal() {
  const config = getAnalyticsConfig();
  const bigquery = new BigQuery({ projectId: config.projectId });

  await buildDerivedTables(bigquery, config);

  const [unitMetadata, userNames] = await Promise.all([
    fetchUnitMetadata(),
    fetchUserNames(),
  ]);

  const [overviewDoc, scopedOverviewDocs, unitSummaries, questionAnalysisDocs, correlationDocs, unitRankingDocs, publicReportDocs] = await Promise.all([
    buildOverviewDoc(bigquery, config, userNames, unitMetadata),
    buildScopedOverviewDocs(bigquery, config, userNames, unitMetadata),
    buildUnitSummaries(bigquery, config, unitMetadata),
    buildQuestionAnalysisDocs(bigquery, config, unitMetadata),
    buildCorrelationDocs(bigquery, config, unitMetadata),
    buildUnitRankingDocs(bigquery, config, userNames),
    buildPublicReportDocs(bigquery, config, unitMetadata),
  ]);

  await writeServingDocs(
    config,
    overviewDoc,
    scopedOverviewDocs,
    unitSummaries,
    questionAnalysisDocs,
    correlationDocs,
    unitRankingDocs,
    publicReportDocs
  );

  return {
    ok: true,
    unitCount: unitSummaries.length,
    root: config.servingRoot,
  };
}

export const runAnalyticsAggregation = functions
  .region("us-central1")
  .https.onCall(async (_data, context) => {
    if (!context.auth?.token?.admin) {
      throw new functions.https.HttpsError("permission-denied", "Admin only.");
    }

    try {
      return await runAnalyticsAggregationInternal();
    } catch (error: any) {
      console.error("[runAnalyticsAggregation] failed", error);
      await db.doc(`${getAnalyticsConfig().servingRoot}/job_status/daily`).set(
        {
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: "failed",
          pipelineVersion: 1,
          notes: error?.message || String(error),
        },
        { merge: true }
      );
      throw new functions.https.HttpsError("internal", error?.message || "Aggregation failed.");
    }
  });

export const aggregateAnalyticsDaily = functions
  .region("us-central1")
  .pubsub.schedule("0 4 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    try {
      await runAnalyticsAggregationInternal();
      return null;
    } catch (error: any) {
      console.error("[aggregateAnalyticsDaily] failed", error);
      await db.doc(`${getAnalyticsConfig().servingRoot}/job_status/daily`).set(
        {
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: "failed",
          pipelineVersion: 1,
          notes: error?.message || String(error),
        },
        { merge: true }
      );
      return null;
    }
  });

export const backfillAnalyticsEvents = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw new functions.https.HttpsError("permission-denied", "Admin only.");
    }

    try {
      return await backfillAnalyticsEventsInternal({
        batchSize: data?.batchSize,
        cursor: data?.cursor,
        overwriteExisting: data?.overwriteExisting,
        dryRun: data?.dryRun,
      });
    } catch (error: any) {
      console.error("[backfillAnalyticsEvents] failed", error);
      throw new functions.https.HttpsError("internal", error?.message || "Backfill failed.");
    }
  });
