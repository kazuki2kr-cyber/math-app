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

const DEFAULT_CONFIG: AnalyticsConfig = {
  projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "math-app-26c77",
  datasetId: "analytics",
  location: "asia-northeast1",
  sourceTablePrefix: "analytics_events",
  timezone: "Asia/Tokyo",
  servingRoot: "analytics_serving/current",
};

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

function buildRawJsonExpression(alias = "data"): string {
  return `TO_JSON_STRING(${alias})`;
}

function occurredAtExpr(alias = "data"): string {
  const raw = buildRawJsonExpression(alias);
  return `COALESCE(
    SAFE.TIMESTAMP(JSON_VALUE(${raw}, '$.occurredAt')),
    TIMESTAMP_SECONDS(SAFE_CAST(JSON_VALUE(${raw}, '$.occurredAt._seconds') AS INT64))
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

async function runQuery(bigquery: BigQuery, config: AnalyticsConfig, query: string) {
  const [rows] = await bigquery.query({
    query,
    location: config.location,
    useLegacySql: false,
  });
  return rows as any[];
}

function buildFactAttemptsSql(config: AnalyticsConfig): string {
  const rawLatestTable = tableRef(config, `${config.sourceTablePrefix}_raw_latest`);
  return `
CREATE OR REPLACE TABLE ${tableRef(config, "fact_attempts")}
PARTITION BY occurred_date
CLUSTER BY unit_id, uid AS
WITH raw_events AS (
  SELECT
    ${buildRawJsonExpression()} AS raw_json
  FROM ${rawLatestTable}
),
last_reset AS (
  SELECT
    MAX(${occurredAtExpr("PARSE_JSON(raw_json)")}) AS reset_at
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
    ${occurredAtExpr("PARSE_JSON(raw_json)")} AS occurred_at,
    DATE(${occurredAtExpr("PARSE_JSON(raw_json)")}, '${config.timezone}') AS occurred_date,
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
    ${occurredAtExpr("PARSE_JSON(raw_json)")} AS deleted_at
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
    ${buildRawJsonExpression()} AS raw_json
  FROM ${rawLatestTable}
),
last_reset AS (
  SELECT
    MAX(${occurredAtExpr("PARSE_JSON(raw_json)")}) AS reset_at
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
    ${occurredAtExpr("PARSE_JSON(raw_json)")} AS occurred_at,
    DATE(${occurredAtExpr("PARSE_JSON(raw_json)")}, '${config.timezone}') AS occurred_date,
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
    ${occurredAtExpr("PARSE_JSON(raw_json)")} AS deleted_at
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
    is_correct
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
    SUM(CASE WHEN left_side.is_correct AND right_side.is_correct THEN 1 ELSE 0 END) AS n11,
    SUM(CASE WHEN left_side.is_correct AND NOT right_side.is_correct THEN 1 ELSE 0 END) AS n10,
    SUM(CASE WHEN NOT left_side.is_correct AND right_side.is_correct THEN 1 ELSE 0 END) AS n01,
    SUM(CASE WHEN NOT left_side.is_correct AND NOT right_side.is_correct THEN 1 ELSE 0 END) AS n00
  FROM base left_side
  JOIN base right_side
    ON left_side.unit_id = right_side.unit_id
   AND left_side.uid = right_side.uid
   AND left_side.question_id < right_side.question_id
  GROUP BY unit_id, question_id_a, question_id_b
)
SELECT
  unit_id,
  question_id_a,
  question_id_b,
  question_order_a,
  question_order_b,
  support_users,
  SAFE_DIVIDE(
    (n11 * n00) - (n10 * n01),
    SQRT((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00))
  ) AS phi,
  CASE
    WHEN SAFE_DIVIDE(
      (n11 * n00) - (n10 * n01),
      SQRT((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00))
    ) >= 0 THEN 'positive'
    ELSE 'negative'
  END AS direction,
  CASE
    WHEN ABS(SAFE_DIVIDE(
      (n11 * n00) - (n10 * n01),
      SQRT((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00))
    )) >= 0.7 THEN 'strong'
    ELSE 'moderate'
  END AS strength
FROM pairs
WHERE support_users >= 5
  AND ABS(SAFE_DIVIDE(
    (n11 * n00) - (n10 * n01),
    SQRT((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00))
  )) >= 0.5
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
      subject: unitData.subject || "数学",
      category: unitData.category || "その他",
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
      data.displayName || data.name || data.email || "ユーザー"
    );
  }

  return names;
}

async function buildOverviewDoc(
  bigquery: BigQuery,
  config: AnalyticsConfig,
  userNames: Map<string, string>,
  unitMetadata: Map<string, UnitMetadata>
) {
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
  `);

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
),
at_risk AS (
  SELECT
    uid,
    AVG(CAST(is_correct AS INT64)) * 100 AS accuracy,
    COUNT(*) AS answered_count
  FROM ${tableRef(config, "fact_attempt_question_results")}
  WHERE occurred_date >= DATE_SUB(CURRENT_DATE('${config.timezone}'), INTERVAL 14 DAY)
  GROUP BY uid
)
SELECT
  AVG(IF(attempt_order = 1, CAST(is_correct AS INT64), NULL)) * 100 AS firstAttemptAccuracy,
  (
    AVG(IF(attempt_order > 1, CAST(is_correct AS INT64), NULL)) -
    AVG(IF(attempt_order = 1, CAST(is_correct AS INT64), NULL))
  ) * 100 AS retryImprovementRate,
  COUNTIF(answered_count >= 10 AND accuracy < 50) AS atRiskUsers
FROM attempts
CROSS JOIN at_risk
  `);

  const bySubject = await runQuery(bigquery, config, `
SELECT
  subject,
  COUNT(*) AS totalAttempts,
  SAFE_DIVIDE(SUM(correct_count), NULLIF(SUM(answered_count), 0)) * 100 AS avgAccuracy
FROM ${tableRef(config, "fact_attempts")}
GROUP BY subject
ORDER BY totalAttempts DESC
  `);

  const topAccuracyRows = await runQuery(bigquery, config, `
SELECT
  uid,
  AVG(score) AS value,
  AVG(time_sec) AS avgTime,
  COUNT(*) AS attempts
FROM ${tableRef(config, "fact_attempts")}
GROUP BY uid
HAVING attempts >= 3
ORDER BY value DESC, avgTime ASC
LIMIT 10
  `);

  const topCorrectRows = await runQuery(bigquery, config, `
SELECT
  uid,
  SUM(correct_count) AS value,
  COUNT(*) AS attempts
FROM ${tableRef(config, "fact_attempts")}
GROUP BY uid
ORDER BY value DESC, attempts DESC
LIMIT 10
  `);

  const worstAccuracyRows = [...topAccuracyRows]
    .sort((left, right) => Number(left.value || 0) - Number(right.value || 0));
  const worstCorrectRows = [...topCorrectRows]
    .sort((left, right) => Number(left.value || 0) - Number(right.value || 0));

  const currentDate = new Date().toISOString().slice(0, 10);
  const earliestDateQuery = await runQuery(bigquery, config, `
SELECT
  MIN(CAST(occurred_date AS STRING)) AS startDate
FROM ${tableRef(config, "fact_attempts")}
  `);

  return {
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
      subject: row.subject || "数学",
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
        rankValue: `${Number(row.avgTime || 0).toFixed(0)}秒`,
      })),
      worstAccuracy: worstAccuracyRows.map((row) => ({
        uid: row.uid,
        userName: userNames.get(row.uid) || row.uid,
        value: Number(row.value || 0),
        displayValue: `${Number(row.value || 0).toFixed(1)}%`,
        avgTime: Number(row.avgTime || 0),
        rankValue: `${Number(row.avgTime || 0).toFixed(0)}秒`,
      })),
      topCorrect: topCorrectRows.map((row) => ({
        uid: row.uid,
        userName: userNames.get(row.uid) || row.uid,
        value: Number(row.value || 0),
        displayValue: `${Number(row.value || 0).toLocaleString()}問`,
        rankValue: `${Number(row.attempts || 0)} attempt`,
      })),
      worstCorrect: worstCorrectRows.map((row) => ({
        uid: row.uid,
        userName: userNames.get(row.uid) || row.uid,
        value: Number(row.value || 0),
        displayValue: `${Number(row.value || 0).toLocaleString()}問`,
        rankValue: `${Number(row.attempts || 0)} attempt`,
      })),
    },
    metadata: {
      unitsTracked: unitMetadata.size,
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
      subject: unitMeta?.subject || row.subject || "数学",
      category: unitMeta?.category || row.category || "その他",
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
  phi,
  direction,
  strength
FROM ${tableRef(config, "agg_question_pair_current")}
ORDER BY unit_id, ABS(phi) DESC, support_users DESC
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
  unitSummaries: any[],
  questionAnalysisDocs: Map<string, any[]>,
  correlationDocs: Map<string, any[]>
) {
  const root = config.servingRoot;
  const batch = db.batch();

  batch.set(db.doc(`${root}/overview/current`), overviewDoc, { merge: true });
  batch.set(
    db.doc(`${root}/manifest/current`),
    {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      version: 1,
      overviewPath: `${root}/overview/current`,
      unitSummaryCollection: `${root}/unit_summaries`,
      questionAnalysisCollection: `${root}/question_analysis`,
      questionCorrelationCollection: `${root}/question_correlations`,
    },
    { merge: true }
  );

  for (const summary of unitSummaries) {
    batch.set(db.doc(`${root}/unit_summaries/${summary.unitId}`), summary, { merge: true });
  }

  for (const [unitId, questions] of questionAnalysisDocs.entries()) {
    batch.set(
      db.doc(`${root}/question_analysis/${unitId}`),
      {
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        unitId,
        questions,
      },
      { merge: true }
    );
  }

  for (const [unitId, pairs] of correlationDocs.entries()) {
    batch.set(
      db.doc(`${root}/question_correlations/${unitId}`),
      {
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        unitId,
        minSupportUsers: 5,
        pairs: pairs.slice(0, 100),
      },
      { merge: true }
    );
  }

  batch.set(
    db.doc(`${root}/job_status/daily`),
    {
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "success",
      pipelineVersion: 1,
    },
    { merge: true }
  );

  await batch.commit();
}

async function runAnalyticsAggregationInternal() {
  const config = getAnalyticsConfig();
  const bigquery = new BigQuery({ projectId: config.projectId });

  await buildDerivedTables(bigquery, config);

  const [unitMetadata, userNames] = await Promise.all([
    fetchUnitMetadata(),
    fetchUserNames(),
  ]);

  const [overviewDoc, unitSummaries, questionAnalysisDocs, correlationDocs] = await Promise.all([
    buildOverviewDoc(bigquery, config, userNames, unitMetadata),
    buildUnitSummaries(bigquery, config, unitMetadata),
    buildQuestionAnalysisDocs(bigquery, config, unitMetadata),
    buildCorrelationDocs(bigquery, config, unitMetadata),
  ]);

  await writeServingDocs(config, overviewDoc, unitSummaries, questionAnalysisDocs, correlationDocs);

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
