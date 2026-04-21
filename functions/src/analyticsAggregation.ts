import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { BigQuery } from "@google-cloud/bigquery";

const db = admin.firestore();

type AnalyticsConfig = {
  projectId: string;
  datasetId: string;
  location: string;
  sourceTablePrefix: string;
  timezone: string;
  servingRoot: string;
};

type OverviewTotalsRow = {
  total_attempts: number | string;
  unique_users: number | string;
  avg_accuracy: number | string;
  total_answered: number | string;
  total_correct: number | string;
};

type SubjectRow = {
  subject: string | null;
  total_attempts: number | string;
  avg_accuracy: number | string;
};

type RankingRow = {
  uid: string;
  value: number | string;
};

type UnitSummaryRow = {
  unit_id: string;
  unit_title: string | null;
  subject: string | null;
  category: string | null;
  total_attempts: number | string;
  unique_users: number | string;
  avg_accuracy: number | string;
  avg_time_sec: number | string;
};

type UnitQuestionRow = {
  unit_id: string;
  question_id: string;
  question_order: number | string;
  total: number | string;
  correct: number | string;
  accuracy: number | string;
  difficulty: string;
};

type UnitQuestionExtremesRow = UnitQuestionRow & {
  hardest_rank?: number | string | null;
  easiest_rank?: number | string | null;
};

type CorrelationRow = {
  unit_id: string;
  question_id_a: string;
  question_id_b: string;
  phi: number | string;
  support_users: number | string;
  direction: string;
  strength: string;
};

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function getConfig(): AnalyticsConfig {
  const raw = (((functions as any).config?.() || {}).analytics || {}) as Record<string, string>;
  const projectId = String(raw.project_id || admin.app().options.projectId || "");

  if (!projectId) {
    throw new Error("analytics.project_id or Firebase project id is required");
  }

  return {
    projectId,
    datasetId: String(raw.dataset_id || "analytics"),
    location: String(raw.location || "asia-northeast1"),
    sourceTablePrefix: String(raw.source_table_prefix || "analytics_events"),
    timezone: String(raw.timezone || "Asia/Tokyo"),
    servingRoot: String(raw.serving_root || "analytics_serving"),
  };
}

function tableName(config: AnalyticsConfig, suffix: string): string {
  return `\`${config.projectId}.${config.datasetId}.${suffix}\``;
}

function rawLatestTable(config: AnalyticsConfig): string {
  return tableName(config, `${config.sourceTablePrefix}_raw_latest`);
}

function rawChangelogTable(config: AnalyticsConfig): string {
  return tableName(config, `${config.sourceTablePrefix}_raw_changelog`);
}

function buildFactAttemptsSql(config: AnalyticsConfig): string {
  return `
CREATE OR REPLACE TABLE ${tableName(config, "fact_attempts")}
PARTITION BY occurred_date
OPTIONS (partition_expiration_days = 366)
CLUSTER BY unit_id, uid AS
WITH source_events AS (
  SELECT data
  FROM ${rawLatestTable(config)}
  WHERE JSON_VALUE(data, '$.eventType') IN ('ATTEMPT_SUBMITTED', 'ATTEMPT_DELETED', 'ALL_DATA_RESET')
),
last_reset AS (
  SELECT MAX(TIMESTAMP(JSON_VALUE(data, '$.occurredAt'))) AS reset_at
  FROM source_events
  WHERE JSON_VALUE(data, '$.eventType') = 'ALL_DATA_RESET'
),
submitted_attempts AS (
  SELECT
    JSON_VALUE(data, '$.attemptId') AS attempt_id,
    JSON_VALUE(data, '$.uid') AS uid,
    JSON_VALUE(data, '$.unitId') AS unit_id,
    COALESCE(JSON_VALUE(data, '$.unitTitle'), '') AS unit_title,
    COALESCE(JSON_VALUE(data, '$.subject'), '数学') AS subject,
    COALESCE(JSON_VALUE(data, '$.category'), 'その他') AS category,
    TIMESTAMP(JSON_VALUE(data, '$.occurredAt')) AS occurred_at,
    DATE(TIMESTAMP(JSON_VALUE(data, '$.occurredAt')), '${config.timezone}') AS occurred_date,
    SAFE_CAST(JSON_VALUE(data, '$.score') AS INT64) AS score,
    SAFE_CAST(JSON_VALUE(data, '$.timeSec') AS INT64) AS time_sec,
    SAFE_CAST(JSON_VALUE(data, '$.xpGain') AS INT64) AS xp_gain,
    SAFE_CAST(JSON_VALUE(data, '$.correctCount') AS INT64) AS correct_count,
    SAFE_CAST(JSON_VALUE(data, '$.answeredCount') AS INT64) AS answered_count
  FROM source_events
  WHERE JSON_VALUE(data, '$.eventType') = 'ATTEMPT_SUBMITTED'
),
deleted_attempts AS (
  SELECT DISTINCT JSON_VALUE(data, '$.attemptId') AS attempt_id
  FROM source_events
  WHERE JSON_VALUE(data, '$.eventType') = 'ATTEMPT_DELETED'
    AND TIMESTAMP(JSON_VALUE(data, '$.occurredAt')) >= COALESCE((SELECT reset_at FROM last_reset), TIMESTAMP('1970-01-01'))
)
SELECT s.*
FROM submitted_attempts s
WHERE s.occurred_at >= COALESCE((SELECT reset_at FROM last_reset), TIMESTAMP('1970-01-01'))
  AND s.attempt_id NOT IN (SELECT attempt_id FROM deleted_attempts WHERE attempt_id IS NOT NULL)
`;
}

function buildFactAttemptQuestionResultsSql(config: AnalyticsConfig): string {
  return `
CREATE OR REPLACE TABLE ${tableName(config, "fact_attempt_question_results")}
PARTITION BY occurred_date
OPTIONS (partition_expiration_days = 366)
CLUSTER BY unit_id, question_id, uid AS
WITH submitted_events AS (
  SELECT
    JSON_VALUE(data, '$.attemptId') AS attempt_id,
    JSON_VALUE(data, '$.uid') AS uid,
    JSON_VALUE(data, '$.unitId') AS unit_id,
    COALESCE(JSON_VALUE(data, '$.unitTitle'), '') AS unit_title,
    COALESCE(JSON_VALUE(data, '$.subject'), '数学') AS subject,
    COALESCE(JSON_VALUE(data, '$.category'), 'その他') AS category,
    TIMESTAMP(JSON_VALUE(data, '$.occurredAt')) AS occurred_at,
    DATE(TIMESTAMP(JSON_VALUE(data, '$.occurredAt')), '${config.timezone}') AS occurred_date,
    SAFE_CAST(JSON_VALUE(data, '$.score') AS INT64) AS score,
    SAFE_CAST(JSON_VALUE(data, '$.timeSec') AS INT64) AS time_sec,
    JSON_QUERY_ARRAY(data, '$.questionResults') AS question_results
  FROM ${rawLatestTable(config)}
  WHERE JSON_VALUE(data, '$.eventType') = 'ATTEMPT_SUBMITTED'
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
  s.time_sec
FROM submitted_events s
JOIN ${tableName(config, "fact_attempts")} valid_attempts
  ON valid_attempts.attempt_id = s.attempt_id,
UNNEST(s.question_results) AS question_result
`;
}

function buildAggUnitDailySql(config: AnalyticsConfig): string {
  return `
CREATE OR REPLACE TABLE ${tableName(config, "agg_unit_daily")}
PARTITION BY stat_date
OPTIONS (partition_expiration_days = 366)
CLUSTER BY unit_id AS
SELECT
  occurred_date AS stat_date,
  unit_id,
  ANY_VALUE(unit_title) AS unit_title,
  ANY_VALUE(subject) AS subject,
  ANY_VALUE(category) AS category,
  COUNT(*) AS total_attempts,
  COUNT(DISTINCT uid) AS unique_users,
  SUM(answered_count) AS total_answered,
  SUM(correct_count) AS total_correct,
  SAFE_DIVIDE(SUM(correct_count), SUM(answered_count)) * 100 AS avg_accuracy,
  AVG(time_sec) AS avg_time_sec
FROM ${tableName(config, "fact_attempts")}
GROUP BY stat_date, unit_id
`;
}

function buildAggQuestionDailySql(config: AnalyticsConfig): string {
  return `
CREATE OR REPLACE TABLE ${tableName(config, "agg_question_daily")}
PARTITION BY stat_date
OPTIONS (partition_expiration_days = 366)
CLUSTER BY unit_id, question_id AS
SELECT
  occurred_date AS stat_date,
  unit_id,
  question_id,
  ANY_VALUE(question_order) AS question_order,
  COUNT(*) AS total,
  SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) AS correct,
  SAFE_DIVIDE(SUM(CASE WHEN is_correct THEN 1 ELSE 0 END), COUNT(*)) * 100 AS accuracy,
  CASE
    WHEN SAFE_DIVIDE(SUM(CASE WHEN is_correct THEN 1 ELSE 0 END), COUNT(*)) >= 0.90 THEN 'very_easy'
    WHEN SAFE_DIVIDE(SUM(CASE WHEN is_correct THEN 1 ELSE 0 END), COUNT(*)) >= 0.70 THEN 'easy'
    WHEN SAFE_DIVIDE(SUM(CASE WHEN is_correct THEN 1 ELSE 0 END), COUNT(*)) >= 0.40 THEN 'normal'
    WHEN SAFE_DIVIDE(SUM(CASE WHEN is_correct THEN 1 ELSE 0 END), COUNT(*)) >= 0.20 THEN 'hard'
    ELSE 'very_hard'
  END AS difficulty
FROM ${tableName(config, "fact_attempt_question_results")}
GROUP BY stat_date, unit_id, question_id
`;
}

function buildAggQuestionPairCurrentSql(config: AnalyticsConfig): string {
  return `
CREATE OR REPLACE TABLE ${tableName(config, "agg_question_pair_current")}
CLUSTER BY unit_id, question_id_a, question_id_b AS
WITH user_question_outcomes AS (
  SELECT
    unit_id,
    uid,
    question_id,
    MAX(CASE WHEN is_correct THEN 1 ELSE 0 END) AS answered_correctly
  FROM ${tableName(config, "fact_attempt_question_results")}
  GROUP BY unit_id, uid, question_id
),
pairs AS (
  SELECT
    a.unit_id,
    a.question_id AS question_id_a,
    b.question_id AS question_id_b,
    COUNT(*) AS support_users,
    SUM(CASE WHEN a.answered_correctly = 1 AND b.answered_correctly = 1 THEN 1 ELSE 0 END) AS n11,
    SUM(CASE WHEN a.answered_correctly = 1 AND b.answered_correctly = 0 THEN 1 ELSE 0 END) AS n10,
    SUM(CASE WHEN a.answered_correctly = 0 AND b.answered_correctly = 1 THEN 1 ELSE 0 END) AS n01,
    SUM(CASE WHEN a.answered_correctly = 0 AND b.answered_correctly = 0 THEN 1 ELSE 0 END) AS n00
  FROM user_question_outcomes a
  JOIN user_question_outcomes b
    ON a.unit_id = b.unit_id
   AND a.uid = b.uid
   AND a.question_id < b.question_id
  GROUP BY a.unit_id, a.question_id, b.question_id
),
scored AS (
  SELECT
    CURRENT_DATE('${config.timezone}') AS stat_date,
    unit_id,
    question_id_a,
    question_id_b,
    question_text_a,
    question_text_b,
    support_users,
    SAFE_DIVIDE(
      (n11 * n00) - (n10 * n01),
      SQRT((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00))
    ) AS phi
  FROM pairs
)
SELECT
  stat_date,
  unit_id,
  question_id_a,
  question_id_b,
  support_users,
  phi,
  CASE WHEN phi >= 0 THEN 'positive' ELSE 'negative' END AS direction,
  CASE WHEN ABS(phi) >= 0.7 THEN 'strong' ELSE 'moderate' END AS strength
FROM scored
WHERE support_users >= 5
`;
}

async function runQuery(bigquery: BigQuery, config: AnalyticsConfig, query: string) {
  await bigquery.query({
    query,
    location: config.location,
  });
}

async function selectRows<T>(bigquery: BigQuery, config: AnalyticsConfig, query: string): Promise<T[]> {
  const [rows] = await bigquery.query({
    query,
    location: config.location,
  });
  return rows as T[];
}

async function fetchDisplayNames(uids: string[]): Promise<Map<string, string>> {
  const uniqueUids = Array.from(new Set(uids.filter(Boolean)));
  const result = new Map<string, string>();

  for (let i = 0; i < uniqueUids.length; i += 10) {
    const chunk = uniqueUids.slice(i, i + 10);
    const snaps = await db.getAll(...chunk.map((uid) => db.doc(`users/${uid}`)));
    snaps.forEach((snap, index) => {
      const uid = chunk[index];
      const data = snap.data() || {};
      const displayName = String(data.displayName || data.name || data.userName || uid);
      result.set(uid, displayName);
    });
  }

  return result;
}

async function fetchQuestionMetadata(unitIds: string[]) {
  const metadata = new Map<string, Map<string, { text: string; order: number }>>();

  await Promise.all(unitIds.map(async (unitId) => {
    const snap = await db.collection(`units/${unitId}/questions`).get();
    const map = new Map<string, { text: string; order: number }>();
    snap.docs.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      map.set(doc.id, {
        text: String(data.question_text || ""),
        order: Number(data.order || 0),
      });
    });
    metadata.set(unitId, map);
  }));

  return metadata;
}

async function ensureAnalyticsTables(bigquery: BigQuery, config: AnalyticsConfig) {
  await bigquery.dataset(config.datasetId).get({ autoCreate: true });
  await runQuery(bigquery, config, `
    ALTER TABLE ${rawLatestTable(config)}
    SET OPTIONS (partition_expiration_days = 366)
  `);
  await runQuery(bigquery, config, `
    ALTER TABLE ${rawChangelogTable(config)}
    SET OPTIONS (partition_expiration_days = 366)
  `);
  await runQuery(bigquery, config, buildFactAttemptsSql(config));
  await runQuery(bigquery, config, buildFactAttemptQuestionResultsSql(config));
  await runQuery(bigquery, config, buildAggUnitDailySql(config));
  await runQuery(bigquery, config, buildAggQuestionDailySql(config));
  await runQuery(bigquery, config, buildAggQuestionPairCurrentSql(config));
}

async function writeServingDocuments(bigquery: BigQuery, config: AnalyticsConfig) {
  const generatedAt = admin.firestore.Timestamp.now();
  const servingRoot = config.servingRoot;

  const [overviewRows, subjectRows, topAccuracyRows, topCorrectRows, unitSummaryRows, questionRows, extremeRows, correlationRows] =
    await Promise.all([
      selectRows<OverviewTotalsRow>(bigquery, config, `
        SELECT
          COUNT(*) AS total_attempts,
          COUNT(DISTINCT uid) AS unique_users,
          SAFE_DIVIDE(SUM(correct_count), SUM(answered_count)) * 100 AS avg_accuracy,
          SUM(answered_count) AS total_answered,
          SUM(correct_count) AS total_correct
        FROM ${tableName(config, "fact_attempts")}
      `),
      selectRows<SubjectRow>(bigquery, config, `
        SELECT
          subject,
          COUNT(*) AS total_attempts,
          SAFE_DIVIDE(SUM(correct_count), SUM(answered_count)) * 100 AS avg_accuracy
        FROM ${tableName(config, "fact_attempts")}
        GROUP BY subject
        ORDER BY total_attempts DESC, subject
      `),
      selectRows<RankingRow>(bigquery, config, `
        SELECT
          uid,
          SAFE_DIVIDE(SUM(correct_count), SUM(answered_count)) * 100 AS value
        FROM ${tableName(config, "fact_attempts")}
        GROUP BY uid
        HAVING SUM(answered_count) > 0
        ORDER BY value DESC, SUM(answered_count) DESC
        LIMIT 10
      `),
      selectRows<RankingRow>(bigquery, config, `
        SELECT
          uid,
          SUM(correct_count) AS value
        FROM ${tableName(config, "fact_attempts")}
        GROUP BY uid
        ORDER BY value DESC
        LIMIT 10
      `),
      selectRows<UnitSummaryRow>(bigquery, config, `
        SELECT
          unit_id,
          ANY_VALUE(unit_title) AS unit_title,
          ANY_VALUE(subject) AS subject,
          ANY_VALUE(category) AS category,
          COUNT(*) AS total_attempts,
          COUNT(DISTINCT uid) AS unique_users,
          SAFE_DIVIDE(SUM(correct_count), SUM(answered_count)) * 100 AS avg_accuracy,
          AVG(time_sec) AS avg_time_sec
        FROM ${tableName(config, "fact_attempts")}
        GROUP BY unit_id
      `),
      selectRows<UnitQuestionRow>(bigquery, config, `
        SELECT
          unit_id,
          question_id,
          ANY_VALUE(question_order) AS question_order,
          SUM(total) AS total,
          SUM(correct) AS correct,
          SAFE_DIVIDE(SUM(correct), SUM(total)) * 100 AS accuracy,
          CASE
            WHEN SAFE_DIVIDE(SUM(correct), SUM(total)) >= 0.90 THEN 'very_easy'
            WHEN SAFE_DIVIDE(SUM(correct), SUM(total)) >= 0.70 THEN 'easy'
            WHEN SAFE_DIVIDE(SUM(correct), SUM(total)) >= 0.40 THEN 'normal'
            WHEN SAFE_DIVIDE(SUM(correct), SUM(total)) >= 0.20 THEN 'hard'
            ELSE 'very_hard'
          END AS difficulty
        FROM ${tableName(config, "agg_question_daily")}
        GROUP BY unit_id, question_id
      `),
      selectRows<UnitQuestionExtremesRow>(bigquery, config, `
        WITH aggregated AS (
          SELECT
            unit_id,
            question_id,
            ANY_VALUE(question_order) AS question_order,
            SUM(total) AS total,
            SUM(correct) AS correct,
            SAFE_DIVIDE(SUM(correct), SUM(total)) * 100 AS accuracy
          FROM ${tableName(config, "agg_question_daily")}
          GROUP BY unit_id, question_id
        )
        SELECT *
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (PARTITION BY unit_id ORDER BY accuracy ASC, total DESC, question_id) AS hardest_rank,
            ROW_NUMBER() OVER (PARTITION BY unit_id ORDER BY accuracy DESC, total DESC, question_id) AS easiest_rank
          FROM aggregated
        )
        WHERE hardest_rank <= 3 OR easiest_rank <= 3
      `),
      selectRows<CorrelationRow>(bigquery, config, `
        SELECT *
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (PARTITION BY unit_id ORDER BY ABS(phi) DESC, support_users DESC) AS rank_in_unit
          FROM ${tableName(config, "agg_question_pair_current")}
          WHERE ABS(phi) >= 0.3
        )
        WHERE rank_in_unit <= 100
      `),
    ]);

  const overview = overviewRows[0] || {
    total_attempts: 0,
    unique_users: 0,
    avg_accuracy: 0,
    total_answered: 0,
    total_correct: 0,
  };

  const rankingNameMap = await fetchDisplayNames([
    ...topAccuracyRows.map((row) => row.uid),
    ...topCorrectRows.map((row) => row.uid),
  ]);
  const questionMetadataByUnit = await fetchQuestionMetadata(unitSummaryRows.map((row) => row.unit_id));

  await db.doc(`${servingRoot}/admin_overview/current`).set({
    generatedAt,
    totals: {
      totalAttempts: toNumber(overview.total_attempts),
      uniqueUsers: toNumber(overview.unique_users),
      avgAccuracy: toNumber(overview.avg_accuracy),
      totalAnswered: toNumber(overview.total_answered),
      totalCorrect: toNumber(overview.total_correct),
    },
    bySubject: subjectRows.map((row) => ({
      subject: row.subject || "数学",
      totalAttempts: toNumber(row.total_attempts),
      avgAccuracy: toNumber(row.avg_accuracy),
    })),
    rankings: {
      topAccuracy: topAccuracyRows.map((row) => ({
        uid: row.uid,
        userName: rankingNameMap.get(row.uid) || row.uid,
        value: toNumber(row.value),
      })),
      topCorrect: topCorrectRows.map((row) => ({
        uid: row.uid,
        userName: rankingNameMap.get(row.uid) || row.uid,
        value: toNumber(row.value),
      })),
    },
  });

  const unitQuestionMap = new Map<string, UnitQuestionRow[]>();
  for (const row of questionRows) {
    const list = unitQuestionMap.get(row.unit_id) || [];
    list.push(row);
    unitQuestionMap.set(row.unit_id, list);
  }

  const extremesMap = new Map<string, { hardest: UnitQuestionExtremesRow[]; easiest: UnitQuestionExtremesRow[] }>();
  for (const row of extremeRows) {
    const current = extremesMap.get(row.unit_id) || { hardest: [], easiest: [] };
    if (toNumber(row.hardest_rank) > 0 && toNumber(row.hardest_rank) <= 3) {
      current.hardest.push(row);
    }
    if (toNumber(row.easiest_rank) > 0 && toNumber(row.easiest_rank) <= 3) {
      current.easiest.push(row);
    }
    extremesMap.set(row.unit_id, current);
  }

  const correlationMap = new Map<string, CorrelationRow[]>();
  for (const row of correlationRows) {
    const list = correlationMap.get(row.unit_id) || [];
    list.push(row);
    correlationMap.set(row.unit_id, list);
  }

  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const unit of unitSummaryRows) {
    const unitId = unit.unit_id;
    const questionMetadata = questionMetadataByUnit.get(unitId) || new Map<string, { text: string; order: number }>();
    const questionsForUnit = (unitQuestionMap.get(unitId) || [])
      .map((row) => ({
        questionId: row.question_id,
        questionOrder: toNumber(row.question_order) || questionMetadata.get(row.question_id)?.order || 0,
        questionText: questionMetadata.get(row.question_id)?.text || "",
        total: toNumber(row.total),
        correct: toNumber(row.correct),
        accuracy: toNumber(row.accuracy),
        difficulty: row.difficulty,
      }))
      .sort((a, b) => a.questionOrder - b.questionOrder);

    const extremes = extremesMap.get(unitId) || { hardest: [], easiest: [] };
    const normalizeExtreme = (row: UnitQuestionExtremesRow) => ({
      questionId: row.question_id,
      questionText: questionMetadata.get(row.question_id)?.text || "",
      accuracy: toNumber(row.accuracy),
      total: toNumber(row.total),
    });

    batch.set(db.doc(`${servingRoot}/unit_summaries/${unitId}`), {
      generatedAt,
      unitId,
      unitTitle: unit.unit_title || unitId,
      subject: unit.subject || "数学",
      category: unit.category || "その他",
      totals: {
        totalAttempts: toNumber(unit.total_attempts),
        uniqueUsers: toNumber(unit.unique_users),
        avgAccuracy: toNumber(unit.avg_accuracy),
        avgTimeSec: toNumber(unit.avg_time_sec),
      },
      hardestQuestions: extremes.hardest
        .sort((a, b) => toNumber(a.hardest_rank) - toNumber(b.hardest_rank))
        .map(normalizeExtreme),
      easiestQuestions: extremes.easiest
        .sort((a, b) => toNumber(a.easiest_rank) - toNumber(b.easiest_rank))
        .map(normalizeExtreme),
    });
    ops++;

    batch.set(db.doc(`${servingRoot}/question_analysis/${unitId}`), {
      generatedAt,
      unitId,
      questions: questionsForUnit,
    });
    ops++;

    batch.set(db.doc(`${servingRoot}/question_correlations/${unitId}`), {
      generatedAt,
      unitId,
      minSupportUsers: 5,
      pairs: (correlationMap.get(unitId) || []).map((row) => ({
        questionIdA: row.question_id_a,
        questionIdB: row.question_id_b,
        questionTextA: questionMetadata.get(row.question_id_a)?.text || "",
        questionTextB: questionMetadata.get(row.question_id_b)?.text || "",
        phi: toNumber(row.phi),
        supportUsers: toNumber(row.support_users),
        direction: row.direction,
        strength: row.strength,
      })),
    });
    ops++;

    if (ops >= 400) {
      await flush();
    }
  }

  batch.set(db.doc(`${servingRoot}/manifest/current`), {
    generatedAt,
    unitCount: unitSummaryRows.length,
    questionAnalysisCount: unitQuestionMap.size,
    correlationUnitCount: correlationMap.size,
  });
  ops++;

  batch.set(db.doc(`${servingRoot}/job_status/daily`), {
    generatedAt,
    status: "success",
    pipelineVersion: 1,
    notes: "Analytics aggregation completed successfully.",
  });
  ops++;

  await flush();

  return {
    unitCount: unitSummaryRows.length,
    questionAnalysisCount: unitQuestionMap.size,
    correlationUnitCount: correlationMap.size,
  };
}

async function runAggregation(trigger: string) {
  const config = getConfig();
  const bigquery = new BigQuery({ projectId: config.projectId });
  await ensureAnalyticsTables(bigquery, config);
  const servingStats = await writeServingDocuments(bigquery, config);

  return {
    trigger,
    datasetId: config.datasetId,
    sourceTablePrefix: config.sourceTablePrefix,
    ...servingStats,
  };
}

export const runAnalyticsAggregation = functions
  .region("us-central1")
  .https.onCall(async (_data, context) => {
    if (!context.auth?.token?.admin) {
      throw new functions.https.HttpsError("permission-denied", "Admin only.");
    }

    try {
      return await runAggregation("manual");
    } catch (error: any) {
      await db.doc(`${getConfig().servingRoot}/job_status/daily`).set({
        generatedAt: admin.firestore.Timestamp.now(),
        status: "failed",
        pipelineVersion: 1,
        notes: error?.message || "Unknown analytics aggregation error.",
      }, { merge: true });
      throw new functions.https.HttpsError("internal", error?.message || "Analytics aggregation failed.");
    }
  });

export const aggregateAnalyticsDaily = functions
  .region("us-central1")
  .pubsub.schedule("0 4 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    try {
      await runAggregation("scheduled");
    } catch (error: any) {
      await db.doc(`${getConfig().servingRoot}/job_status/daily`).set({
        generatedAt: admin.firestore.Timestamp.now(),
        status: "failed",
        pipelineVersion: 1,
        notes: error?.message || "Unknown analytics aggregation error.",
      }, { merge: true });
      throw error;
    }
  });
