'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const databasePath = path.resolve(__dirname, '../.local/written-answers/analysis.sqlite');

function listUnits(targetDatabasePath = databasePath) {
  if (!fs.existsSync(targetDatabasePath)) return [];
  const db = new DatabaseSync(targetDatabasePath, { readOnly: true });
  try {
    return db.prepare(`SELECT unit_id AS unitId, unit_title AS unitTitle,
      subject, field, COUNT(*) AS attempts,
      COUNT(DISTINCT learner_key) AS learners,
      COUNT(DISTINCT attempt_group_key) AS attemptGroups,
      COUNT(DISTINCT CASE WHEN lesson_session_id IS NOT NULL THEN lesson_session_id END) AS lessonSessions,
      MIN(submitted_at) AS firstSubmittedAt, MAX(submitted_at) AS lastSubmittedAt
      FROM attempts GROUP BY unit_id, unit_title, subject, field
      ORDER BY lastSubmittedAt DESC, unit_id`).all();
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try { console.log(JSON.stringify(listUnits(), null, 2)); }
  catch (error) { console.error(`分析対象一覧の取得失敗: ${error.message}`); process.exitCode = 1; }
}

module.exports = { listUnits };
