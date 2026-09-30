'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const databasePath = path.resolve(__dirname, '../.local/written-answers/analysis.sqlite');
const states = new Set(['present', 'absent', 'uncertain']);
const reviewStatuses = new Set(['pending', 'confirmed', 'rejected']);

function importAnnotations(inputPath, targetDatabasePath = databasePath) {
  if (!fs.existsSync(targetDatabasePath)) throw new Error('先に分析DBを構築してください。');
  const rows = fs.readFileSync(inputPath, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const db = new DatabaseSync(targetDatabasePath);
  try {
    const hasAttempt = db.prepare('SELECT 1 FROM attempts WHERE attempt_id=?');
    const insert = db.prepare(`INSERT INTO observations
      (attempt_id,tag,extractor_version,state,evidence,source,confidence,review_status,reviewed_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(attempt_id,tag,extractor_version) DO UPDATE SET
      state=excluded.state, evidence=excluded.evidence, confidence=excluded.confidence,
      review_status=excluded.review_status, reviewed_at=excluded.reviewed_at`);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        if (typeof row.attemptId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.attemptId)
          || !hasAttempt.get(row.attemptId)) throw new Error('未登録の答案IDが含まれています。');
        if (typeof row.tag !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(row.tag)
          || !states.has(row.state) || !reviewStatuses.has(row.reviewStatus || 'pending')) {
          throw new Error('観察タグまたは状態が不正です。');
        }
        const confidence = Number(row.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('確信度が不正です。');
        const source = row.source === 'human' ? 'human' : 'codex_review';
        const version = source === 'human' ? 'human-v1' : 'codex-review-v1';
        const reviewStatus = row.reviewStatus || 'pending';
        insert.run(row.attemptId, row.tag, version, row.state,
          String(row.evidence || '').slice(0, 500), source, confidence,
          reviewStatus, reviewStatus === 'pending' ? null : new Date().toISOString());
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return rows.length;
  } finally { db.close(); }
}

if (require.main === module) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: npm.cmd run archive:written:observations -- <annotations.jsonl>');
    process.exitCode = 1;
  } else {
    try { console.log(`観察記録を${importAnnotations(path.resolve(inputPath))}件取り込みました。`); }
    catch (error) { console.error(`観察記録の取込失敗: ${error.message}`); process.exitCode = 1; }
  }
}
module.exports = { importAnnotations };
