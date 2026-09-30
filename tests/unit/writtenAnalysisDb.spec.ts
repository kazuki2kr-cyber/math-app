import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
const { DatabaseSync } = require('node:sqlite');
const { build, observationsFor } = require('../../scripts/build-written-analysis-db');
const { syncExposures } = require('../../scripts/pull-written-answers');
const { importAnnotations } = require('../../scripts/import-written-observations');
const { checkArchive } = require('../../scripts/check-written-analysis-archive');

describe('written answer analysis database', () => {
  let directory: string;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'written-analysis-test-')); });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

  function fixture() {
    const relativePath = 'subject=math/field=equation/unit=u/question=q/learner=anon/attempt=a1';
    const answerDirectory = path.join(directory, relativePath);
    fs.mkdirSync(answerDirectory, { recursive: true });
    const bytes = Buffer.from('test-answer-image');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(answerDirectory, 'answer.png'), bytes);
    const record = {
      schemaVersion: 2, attemptId: 'a1', subject: '数学', field: '方程式',
      unitId: 'u', unitTitle: '方程式', questionId: 'q',
      questionText: '次の方程式を解きなさい。1.1x+1.8=0.5x', modelAnswer: 'x=-3',
      rubric: [{ criterionIndex: 1, label: '計算', maxScore: 10 }],
      submittedAt: '2026-09-30T01:00:00.000Z', score: 5, attemptOrdinal: 1,
      learnerKey: 'anonymous-key', attemptGroupKey: 'group-key',
      lesson: { lessonSessionId: 'lesson-1', classKey: 'class-a', instructionVersion: 'v1' },
      grading: { transcription: '11x+18=5x\n11x-5x=18\n6x=18\nx=3', detectedAnswer: 'x=3',
        feedback: '符号を確認', improvementPoints: ['移項時の符号を確認'],
        rubricScores: [{ criterionIndex: 1, label: '計算', score: 5, maxScore: 10, comment: '符号ミス' }] },
      image: { filename: 'answer.png', contentType: 'image/png', bytes: bytes.length, sha256 },
    };
    fs.writeFileSync(path.join(answerDirectory, 'record.json'), JSON.stringify(record));
    fs.writeFileSync(path.join(directory, 'catalog.jsonl'), JSON.stringify({ ...record, relativePath }) + '\n');
    return { record, imagePath: path.join(answerDirectory, 'answer.png') };
  }

  it('indexes verified originals idempotently and preserves review state', () => {
    fixture();
    const exposureDirectory = path.join(directory, 'exposures');
    fs.mkdirSync(exposureDirectory);
    fs.writeFileSync(path.join(exposureDirectory, `${'a'.repeat(64)}.json`), JSON.stringify({
      attemptId: 'a1', feedbackShownAt: '2026-09-30T01:01:00.000Z',
      modelAnswerShownAt: '2026-09-30T01:02:00.000Z',
    }));
    const dbPath = path.join(directory, 'analysis.sqlite');
    build(directory, dbPath);
    const db = new DatabaseSync(dbPath);
    expect(db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM criterion_scores').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM feedback_items').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM feedback_targets').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM exposures').get().n).toBe(2);
    expect(db.prepare('SELECT class_key FROM lessons').get().class_key).toBe('class-a');
    expect(db.prepare("SELECT state FROM observations WHERE tag='constant_transfer_sign_error'").get().state).toBe('present');
    db.prepare("UPDATE observations SET review_status='confirmed' WHERE tag='constant_transfer_sign_error'").run();
    db.prepare("UPDATE feedback_targets SET review_status='confirmed' WHERE tag='sign_handling'").run();
    db.close();
    build(directory, dbPath);
    const again = new DatabaseSync(dbPath);
    expect(again.prepare('SELECT COUNT(*) AS n FROM attempts').get().n).toBe(1);
    expect(again.prepare("SELECT review_status FROM observations WHERE tag='constant_transfer_sign_error'").get().review_status).toBe('confirmed');
    expect(again.prepare("SELECT review_status FROM feedback_targets WHERE tag='sign_handling'").get().review_status).toBe('confirmed');
    expect(again.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('attempts') WHERE name='uid'").get().n).toBe(0);
    again.close();
  });

  it('refuses to index a tampered image', () => {
    const { imagePath } = fixture();
    fs.writeFileSync(imagePath, 'tampered');
    expect(() => build(directory, path.join(directory, 'analysis.sqlite'))).toThrow('ハッシュ');
  });

  it('reports analysis coverage and detects damage after indexing', () => {
    const { imagePath } = fixture();
    const dbPath = path.join(directory, 'analysis.sqlite');
    build(directory, dbPath);
    const report = checkArchive(directory);
    expect(report.counts.attempts).toBe(1);
    expect(report.counts.pairedGroups).toBe(0);
    expect(report.missingMetadata.lesson).toBe(0);
    expect(fs.existsSync(path.join(directory, 'archive-health.json'))).toBe(true);
    fs.writeFileSync(imagePath, 'damaged');
    expect(() => checkArchive(directory)).toThrow('ハッシュ');
  });

  it('keeps classes and instruction versions separate for one session id', () => {
    const { record } = fixture();
    const dbPath = path.join(directory, 'analysis.sqlite');
    build(directory, dbPath);
    const db = new DatabaseSync(dbPath);
    db.prepare('INSERT INTO lessons VALUES (?,?,?,?)').run('lesson-1', 'class-b', 'v1', record.attemptId);
    db.prepare('INSERT INTO lessons VALUES (?,?,?,?)').run('lesson-1', 'class-a', 'v2', record.attemptId);
    expect(db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE lesson_session_id=?').get('lesson-1').n).toBe(3);
    db.close();
    build(directory, dbPath);
    const again = new DatabaseSync(dbPath);
    expect(again.prepare('SELECT COUNT(*) AS n FROM lessons WHERE lesson_session_id=?').get('lesson-1').n).toBe(3);
    again.close();
  });

  it('imports reviewed tags for any question without changing scores', () => {
    fixture();
    const dbPath = path.join(directory, 'analysis.sqlite');
    build(directory, dbPath);
    const input = path.join(directory, 'observations.jsonl');
    fs.writeFileSync(input, JSON.stringify({ attemptId: 'a1', tag: 'teacher_checked_sign',
      state: 'present', evidence: '移項の符号', confidence: 1, source: 'human', reviewStatus: 'confirmed' }) + '\n');
    expect(importAnnotations(input, dbPath)).toBe(1);
    const db = new DatabaseSync(dbPath);
    expect(db.prepare("SELECT review_status FROM observations WHERE tag='teacher_checked_sign'").get().review_status).toBe('confirmed');
    expect(db.prepare("SELECT score FROM attempts WHERE attempt_id='a1'").get().score).toBe(5);
    db.close();
  });

  it('does not equate a valid alternative method with an error', () => {
    const { record } = fixture();
    record.grading.transcription = '1.1x-0.5x=-1.8\n0.6x=-1.8\nx=-3';
    record.grading.detectedAnswer = 'x=-3';
    expect(observationsFor(record)).toEqual([]);
  });

  it('saves exposure records before acknowledging them without storing uid', async () => {
    const calls: string[] = [];
    const request = async (name: string) => {
      calls.push(name);
      if (name === 'listWrittenResultExposures') return { records: [{
        uid: 'student-uid', attemptId: 'a1', feedbackShownAt: '2026-09-30T01:01:00.000Z',
        modelAnswerShownAt: null,
      }] };
      return { acknowledged: true };
    };
    await expect(syncExposures('token', request, directory)).resolves.toBe(1);
    expect(calls).toEqual(['listWrittenResultExposures', 'acknowledgeWrittenResultExposure']);
    const files = fs.readdirSync(path.join(directory, 'exposures'));
    const saved = fs.readFileSync(path.join(directory, 'exposures', files[0]), 'utf8');
    expect(saved).not.toContain('student-uid');
    expect(JSON.parse(saved).attemptId).toBe('a1');
  });

  it('continues archival when the optional exposure function is not deployed yet', async () => {
    const request = async () => { throw new Error('listWrittenResultExposures: 404'); };
    await expect(syncExposures('token', request, directory)).resolves.toBe(0);
  });
});
