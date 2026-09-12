// Never writes to units. Default is a read-only preview; --apply publishes a new immutable version.
const admin = require('firebase-admin');
const { createHash, randomUUID } = require('crypto');
const PROJECT = 'math-app-26c77';
const ROOT = 'kanji_battle_pools';

function initialize() {
  const { Firestore } = require('@google-cloud/firestore');
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new Firestore({ projectId: PROJECT });
  }
  // Reuse the CLI login in memory; never display or persist credentials.
  const { configstore } = require('firebase-tools/lib/configstore');
  const refreshToken = configstore.get('tokens')?.refresh_token;
  if (!refreshToken) throw new Error('Firebase CLI login required.');
  const { clientId, clientSecret } = require('firebase-tools/lib/api');
  return new Firestore({ projectId: PROJECT, credentials: {
    type: 'authorized_user', client_id: clientId(), client_secret: clientSecret(), refresh_token: refreshToken,
  } });
}

async function readSource(db) {
  const units = await db.collection('units').get();
  const questions = [];
  const fingerprints = [];
  let unitCount = 0;
  for (const unit of units.docs) {
    const data = unit.data();
    if (![data.subject, data.baseSubject].some(value => value === 'kanji' || value === '漢字')) continue;
    unitCount++;
    fingerprints.push([unit.ref.path, unit.updateTime.toMillis()]);
    const embedded = Array.isArray(data.questions) && data.questions.length > 0;
    const rows = embedded ? data.questions.map((q, i) => ({ ...q, id: String(q.id ?? i) }))
      : (await db.collection(`${unit.ref.path}/questions`).get()).docs.map(q => {
        fingerprints.push([q.ref.path, q.updateTime.toMillis()]);
        return { ...q.data(), id: q.id };
      });
    for (const q of rows) {
      const answer = q.answer_index !== undefined && Array.isArray(q.options)
        ? q.options[Number(q.answer_index) - 1] : q.answer;
      if (typeof answer !== 'string' || !answer.trim() || (!q.question_text && !q.image_url)) {
        throw new Error(`Invalid question: ${unit.id}/${q.id}; publication aborted.`);
      }
      questions.push({ sourceUnitId: unit.id, sourceQuestionId: q.id, question_text: String(q.question_text || ''),
        answer: answer.trim(), image_url: q.image_url || null, explanation: String(q.explanation || '') });
    }
  }
  const hash = createHash('sha256').update(JSON.stringify(fingerprints.sort())).digest('hex');
  return { questions, unitCount, hash };
}

async function main() {
  const db = initialize();
  try {
    const source = await readSource(db);
    if (source.questions.length < 10) throw new Error('At least 10 valid questions required.');
    console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'preview',
      project: PROJECT, sourceUnits: source.unitCount, questions: source.questions.length, sourceFingerprint: source.hash }));
    if (!process.argv.includes('--apply')) return;
    const version = randomUUID();
    const versionRef = db.doc(`${ROOT}/${version}`);
    await versionRef.create({ status: 'building', createdAt: admin.firestore.FieldValue.serverTimestamp() });
    for (let i = 0; i < source.questions.length; i += 400) {
      const batch = db.batch();
      source.questions.slice(i, i + 400).forEach((q, index) => batch.create(versionRef.collection('questions').doc(String(i + index)), q));
      await batch.commit();
    }
    const copied = await versionRef.collection('questions').get();
    if (copied.size !== source.questions.length || copied.docs.some(q =>
      JSON.stringify(q.data(), Object.keys(q.data()).sort()) !== JSON.stringify(source.questions[Number(q.id)], Object.keys(q.data()).sort()))) {
      throw new Error('Copy verification failed; active version unchanged.');
    }
    const after = await readSource(db);
    if (after.hash !== source.hash) throw new Error('Source changed during copy; active version unchanged.');
    const metadata = { version, count: copied.size, sourceUnitCount: source.unitCount, sourceFingerprint: source.hash,
      status: 'ready', publishedAt: admin.firestore.FieldValue.serverTimestamp() };
    const batch = db.batch();
    batch.set(versionRef, metadata, { merge: true });
    batch.set(db.doc(`${ROOT}/active`), metadata);
    await batch.commit();
    console.log(JSON.stringify({ publishedVersion: version, verifiedQuestions: copied.size, sourceUnchanged: true }));
  } finally { await db.terminate(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { readSource };
