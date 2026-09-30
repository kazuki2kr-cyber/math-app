'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '../.local/written-answers');
const databasePath = path.join(root, 'analysis.sqlite');
const extractorVersion = 'equation-observations-v1';

function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function canonicalMath(value) {
  return String(value || '').replace(/\\(?:left|right|mathrm|text)\b/g, '')
    .replace(/\\times/g, '×').replace(/\\div/g, '÷')
    .replace(/\\\(|\\\)|\\\[|\\\]/g, '')
    .replace(/[−－]/g, '-').replace(/\s/g, '');
}
function observationsFor(record) {
  const question = canonicalMath(record.questionText);
  if (!question.includes('1.1x+1.8=0.5x')) return [];
  const transcription = canonicalMath(record.grading?.transcription);
  const finalAnswer = canonicalMath(record.grading?.detectedAnswer);
  const observations = [];
  function add(tag, evidence, confidence) {
    observations.push({ tag, state: 'present', evidence, confidence, source: 'ai_transcription' });
  }
  if (/11x-5x=18|6x=18/.test(transcription)) add('constant_transfer_sign_error', '11x-5x=18 または 6x=18', 0.8);
  if (/6x=-18/.test(transcription) && /x=3(?:$|[^\d])/.test(finalAnswer)) {
    add('negative_division_sign_error_candidate', '6x=-18 の後の検出解答が x=3', 0.65);
  }
  if (finalAnswer === 'x=3') add('final_answer_positive_three', '検出解答 x=3', 0.85);
  if (finalAnswer === '6x=-18') add('final_value_not_written', '検出解答が 6x=-18 で終了', 0.75);
  if (/=>|->|⇒|→|↳/.test(String(record.grading?.transcription || ''))) {
    add('arrow_notation_present', 'AI書き起こしに矢印', 0.7);
  }
  return observations;
}
function feedbackTargetsFor(body) {
  const text = String(body || '');
  const patterns = [
    ['decimal_scaling_strategy', /10\s*倍|小数.{0,12}整数/],
    ['sign_handling', /移項|移行|符号|マイナス/],
    ['equality_notation', /等号|矢印|等式/],
    ['division', /割り算|除算|÷|\\div/],
    ['verification', /検算|代入して確か/],
    ['final_answer_expression', /解として|答え.{0,12}明記|x\s*=/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}

function readCatalog(targetRoot = root) {
  const catalog = path.join(targetRoot, 'catalog.jsonl');
  if (!fs.existsSync(catalog)) return [];
  return fs.readFileSync(catalog, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}
function checkedDirectory(targetRoot, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) throw new Error('答案の相対パスがありません。');
  const directory = path.resolve(targetRoot, relativePath);
  const relative = path.relative(targetRoot, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('答案の保存先が不正です。');
  return directory;
}
function verifyRecord(targetRoot, row) {
  const directory = checkedDirectory(targetRoot, row.relativePath);
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'record.json'), 'utf8'));
  if (metadata.attemptId !== row.attemptId || metadata.image?.sha256 !== row.image?.sha256) {
    throw new Error('索引と原本メタデータが一致しません。');
  }
  const filename = metadata.image?.filename;
  if (!/^answer\.(png|jpg|webp)$/.test(filename || '')) throw new Error('画像名が不正です。');
  const bytes = fs.readFileSync(path.join(directory, filename));
  if (bytes.length !== metadata.image.bytes || hash(bytes) !== metadata.image.sha256) {
    throw new Error('原本画像の容量またはハッシュが一致しません。');
  }
  if (metadata.uid || metadata.userName || metadata.attemptPath) throw new Error('原本に直接識別子が含まれています。');
  return metadata;
}
function createSchema(db) {
  const oldLessons = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lessons'").get();
  if (oldLessons) {
    const keys = db.prepare('PRAGMA table_info(lessons)').all()
      .filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
    if (keys.join(',') !== 'lesson_session_id,class_key,instruction_version') {
      // lessons is derived entirely from archived records; rebuild older layouts.
      db.exec('DROP TABLE lessons');
    }
  }
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS lessons (
      lesson_session_id TEXT NOT NULL, class_key TEXT NOT NULL,
      instruction_version TEXT NOT NULL, created_from_attempt_id TEXT NOT NULL,
      PRIMARY KEY (lesson_session_id, class_key, instruction_version)
    );
    CREATE TABLE IF NOT EXISTS attempts (
      attempt_id TEXT PRIMARY KEY, learner_key TEXT NOT NULL, attempt_group_key TEXT NOT NULL,
      subject TEXT NOT NULL, field TEXT NOT NULL, unit_id TEXT NOT NULL, unit_title TEXT,
      question_id TEXT NOT NULL, question_text TEXT, question_version TEXT NOT NULL,
      rubric_version TEXT NOT NULL, grading_version TEXT, lesson_session_id TEXT,
      class_key TEXT, instruction_version TEXT, attempt_ordinal INTEGER NOT NULL,
      submitted_at TEXT NOT NULL, score REAL NOT NULL, image_sha256 TEXT NOT NULL,
      image_relative_path TEXT NOT NULL, transcription TEXT, detected_answer TEXT,
      feedback TEXT, model_name TEXT, source_schema_version INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS attempts_unit_session ON attempts(unit_id, lesson_session_id, attempt_ordinal);
    CREATE INDEX IF NOT EXISTS attempts_group ON attempts(attempt_group_key, attempt_ordinal);
    CREATE TABLE IF NOT EXISTS criterion_scores (
      attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE CASCADE,
      criterion_index INTEGER NOT NULL, label TEXT, description TEXT,
      score REAL, max_score REAL, comment TEXT,
      PRIMARY KEY (attempt_id, criterion_index)
    );
    CREATE TABLE IF NOT EXISTS feedback_items (
      attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE CASCADE,
      item_index INTEGER NOT NULL, body TEXT NOT NULL, target_tag TEXT,
      reveals_answer INTEGER, PRIMARY KEY (attempt_id, item_index)
    );
    CREATE TABLE IF NOT EXISTS feedback_targets (
      attempt_id TEXT NOT NULL, item_index INTEGER NOT NULL, tag TEXT NOT NULL,
      extractor_version TEXT NOT NULL, confidence REAL NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'pending',
      PRIMARY KEY (attempt_id, item_index, tag, extractor_version),
      FOREIGN KEY (attempt_id, item_index) REFERENCES feedback_items(attempt_id, item_index) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS observations (
      attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE CASCADE,
      tag TEXT NOT NULL, extractor_version TEXT NOT NULL, state TEXT NOT NULL,
      evidence TEXT, source TEXT NOT NULL, confidence REAL,
      review_status TEXT NOT NULL DEFAULT 'pending', reviewed_at TEXT,
      PRIMARY KEY (attempt_id, tag, extractor_version)
    );
    CREATE INDEX IF NOT EXISTS observations_tag ON observations(tag, state);
    CREATE TABLE IF NOT EXISTS exposures (
      attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE CASCADE,
      kind TEXT NOT NULL, shown_at TEXT NOT NULL, source TEXT NOT NULL,
      PRIMARY KEY (attempt_id, kind)
    );
  `);
}
function importRecords(db, rows, targetRoot) {
  const insertAttempt = db.prepare(`INSERT INTO attempts VALUES (
    ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
  ) ON CONFLICT(attempt_id) DO UPDATE SET
    lesson_session_id=excluded.lesson_session_id, class_key=excluded.class_key,
    instruction_version=excluded.instruction_version, image_relative_path=excluded.image_relative_path,
    score=excluded.score, transcription=excluded.transcription, detected_answer=excluded.detected_answer,
    feedback=excluded.feedback`);
  const insertLesson = db.prepare('INSERT OR IGNORE INTO lessons VALUES (?,?,?,?)');
  const deleteCriteria = db.prepare('DELETE FROM criterion_scores WHERE attempt_id=?');
  const insertCriterion = db.prepare('INSERT INTO criterion_scores VALUES (?,?,?,?,?,?,?)');
  const trimFeedback = db.prepare('DELETE FROM feedback_items WHERE attempt_id=? AND item_index>=?');
  const insertFeedback = db.prepare('INSERT INTO feedback_items VALUES (?,?,?,?,?) ON CONFLICT(attempt_id,item_index) DO UPDATE SET body=excluded.body');
  const insertFeedbackTarget = db.prepare(`INSERT INTO feedback_targets
    (attempt_id,item_index,tag,extractor_version,confidence) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const insertObservation = db.prepare(`INSERT INTO observations
    (attempt_id,tag,extractor_version,state,evidence,source,confidence)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  for (const row of rows) {
    const record = verifyRecord(targetRoot, row);
    const lesson = record.lesson || {};
    const questionVersion = record.questionVersion || hash(JSON.stringify([record.questionText, record.modelAnswer]));
    const rubricVersion = record.rubricVersion || hash(JSON.stringify(record.rubric || []));
    const relativeImage = path.posix.join(row.relativePath.replaceAll('\\', '/'), record.image.filename);
    if (lesson.lessonSessionId) {
      insertLesson.run(lesson.lessonSessionId, lesson.classKey || '',
        lesson.instructionVersion || '', record.attemptId);
    }
    insertAttempt.run(record.attemptId, record.learnerKey, record.attemptGroupKey,
      record.subject, record.field, record.unitId, record.unitTitle || null,
      record.questionId, record.questionText || null, questionVersion, rubricVersion,
      record.gradingVersion || null, lesson.lessonSessionId || null,
      lesson.classKey || null, lesson.instructionVersion || null,
      record.attemptOrdinal, record.submittedAt, record.score, record.image.sha256,
      relativeImage, record.grading?.transcription || null, record.grading?.detectedAnswer || null,
      record.grading?.feedback || null, record.grading?.usageMetadata?.model || null,
      record.schemaVersion || 1);
    deleteCriteria.run(record.attemptId);
    for (const [index, item] of (record.grading?.rubricScores || []).entries()) {
      const rubric = (record.rubric || []).find(r => r.criterionIndex === (item.criterionIndex || index + 1));
      insertCriterion.run(record.attemptId, item.criterionIndex || index + 1,
        item.label || rubric?.label || null, rubric?.description || null,
        item.score ?? null, item.maxScore ?? rubric?.maxScore ?? null, item.comment || null);
    }
    for (const [index, body] of (record.grading?.improvementPoints || []).entries()) {
      insertFeedback.run(record.attemptId, index, body, null, null);
      for (const tag of feedbackTargetsFor(body)) {
        insertFeedbackTarget.run(record.attemptId, index, tag, 'feedback-keywords-v1', 0.5);
      }
    }
    trimFeedback.run(record.attemptId, (record.grading?.improvementPoints || []).length);
    for (const item of observationsFor(record)) {
      insertObservation.run(record.attemptId, item.tag, extractorVersion, item.state,
        item.evidence, item.source, item.confidence);
    }
  }
}
function importExposures(db, targetRoot) {
  const exposureRoot = path.join(targetRoot, 'exposures');
  if (!fs.existsSync(exposureRoot)) return 0;
  const insert = db.prepare('INSERT INTO exposures VALUES (?,?,?,?) ON CONFLICT(attempt_id,kind) DO UPDATE SET shown_at=excluded.shown_at');
  const hasAttempt = db.prepare('SELECT 1 FROM attempts WHERE attempt_id=?');
  let count = 0;
  for (const filename of fs.readdirSync(exposureRoot)) {
    if (!/^[a-f0-9]{64}\.json$/.test(filename)) continue;
    const row = JSON.parse(fs.readFileSync(path.join(exposureRoot, filename), 'utf8'));
    if (!hasAttempt.get(row.attemptId)) continue;
    for (const [kind, field] of [['feedback', 'feedbackShownAt'], ['model_answer', 'modelAnswerShownAt']]) {
      const shownAt = row[field];
      if (typeof shownAt === 'string' && shownAt) {
        insert.run(row.attemptId, kind, shownAt, 'result_screen');
        count++;
      }
    }
  }
  return count;
}
function build(targetRoot = root, targetDatabasePath = databasePath) {
  fs.mkdirSync(targetRoot, { recursive: true });
  const rows = readCatalog(targetRoot);
  const db = new DatabaseSync(targetDatabasePath);
  try {
    createSchema(db);
    db.exec('BEGIN IMMEDIATE');
    try {
      importRecords(db, rows, targetRoot);
      const exposures = importExposures(db, targetRoot);
      db.exec('COMMIT');
      return { attempts: rows.length, exposures, databasePath: targetDatabasePath };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}
if (require.main === module) {
  try {
    const result = build();
    console.log(`記述式分析DB: 答案=${result.attempts}, 表示記録=${result.exposures}`);
    console.log(`保存先: ${result.databasePath}`);
  } catch (error) { console.error(`記述式分析DBの構築に失敗: ${error.message}`); process.exitCode = 1; }
}
module.exports = { build, readCatalog, observationsFor, feedbackTargetsFor, verifyRecord };
