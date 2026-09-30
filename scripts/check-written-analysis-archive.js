'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readCatalog, verifyRecord } = require('./build-written-analysis-db');

const root = path.resolve(__dirname, '../.local/written-answers');

function checkArchive(targetRoot = root, writeReport = true) {
  const dbPath = path.join(targetRoot, 'analysis.sqlite');
  if (!fs.existsSync(path.join(targetRoot, 'catalog.jsonl'))) {
    throw new Error('原本索引がありません。先に答案回収または索引作成を実行してください。');
  }
  if (!fs.existsSync(dbPath)) throw new Error('分析DBがありません。先に答案回収または索引作成を実行してください。');
  const rows = readCatalog(targetRoot);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') {
      throw new Error('SQLiteの整合性検査に失敗しました。');
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('SQLiteの参照整合性検査に失敗しました。');
    }
    const attempts = db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n;
    if (attempts !== rows.length) throw new Error('原本索引とSQLiteの答案件数が一致しません。');
    const hasAttempt = db.prepare('SELECT image_sha256 FROM attempts WHERE attempt_id=?');
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.attemptId)) throw new Error('原本索引に答案IDの重複があります。');
      seen.add(row.attemptId);
      const record = verifyRecord(targetRoot, row);
      if (hasAttempt.get(record.attemptId)?.image_sha256 !== record.image.sha256) {
        throw new Error('原本とSQLiteの画像ハッシュが一致しません。');
      }
    }
    const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    const coverage = db.prepare(`SELECT
      SUM(CASE WHEN lesson_session_id IS NULL THEN 1 ELSE 0 END) AS missingLesson,
      SUM(CASE WHEN class_key IS NULL THEN 1 ELSE 0 END) AS missingClass,
      SUM(CASE WHEN instruction_version IS NULL THEN 1 ELSE 0 END) AS missingInstructionVersion,
      SUM(CASE WHEN grading_version IS NULL THEN 1 ELSE 0 END) AS missingGradingVersion,
      SUM(CASE WHEN source_schema_version < 2 THEN 1 ELSE 0 END) AS legacyRecords
      FROM attempts`).get();
    const pairedGroups = db.prepare(`SELECT COUNT(*) AS n FROM (
      SELECT attempt_group_key FROM attempts GROUP BY attempt_group_key
      HAVING SUM(CASE WHEN attempt_ordinal=1 THEN 1 ELSE 0 END)>0
        AND SUM(CASE WHEN attempt_ordinal=2 THEN 1 ELSE 0 END)>0
    )`).get().n;
    const unlinkedExposures = (() => {
      const exposureRoot = path.join(targetRoot, 'exposures');
      if (!fs.existsSync(exposureRoot)) return 0;
      let n = 0;
      for (const filename of fs.readdirSync(exposureRoot)) {
        if (!/^[a-f0-9]{64}\.json$/.test(filename)) continue;
        const row = JSON.parse(fs.readFileSync(path.join(exposureRoot, filename), 'utf8'));
        if (!hasAttempt.get(row.attemptId)) n++;
      }
      return n;
    })();
    const report = {
      checkedAt: new Date().toISOString(),
      status: unlinkedExposures ? 'needs_attention' : 'ok',
      counts: {
        attempts, pairedGroups, lessons: count('lessons'),
        criterionScores: count('criterion_scores'), feedbackItems: count('feedback_items'),
        feedbackTargets: count('feedback_targets'), observations: count('observations'),
        exposures: count('exposures'), unlinkedExposures,
      },
      missingMetadata: {
        lesson: coverage.missingLesson || 0, classKey: coverage.missingClass || 0,
        instructionVersion: coverage.missingInstructionVersion || 0,
        gradingVersion: coverage.missingGradingVersion || 0,
        legacyRecords: coverage.legacyRecords || 0,
      },
    };
    if (writeReport) {
      const destination = path.join(targetRoot, 'archive-health.json');
      const temporary = `${destination}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, destination);
    }
    return report;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    const report = checkArchive();
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(`記述式アーカイブ検証失敗: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { checkArchive };
