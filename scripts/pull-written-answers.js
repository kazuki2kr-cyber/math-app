'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');

const workspace = path.resolve(__dirname, '..');
const root = path.join(workspace, '.local', 'written-answers');
const projectId = 'math-app-26c77';
dotenv.config({ path: path.join(workspace, '.env.local'), quiet: true });

function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function segment(value) {
  const clean = String(value || '未分類').normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '')
    .slice(0, 56) || '未分類';
  return `${clean}-${digest(String(value || '未分類')).slice(0, 8)}`;
}
async function call(name, data, token) {
  const response = await fetch(`https://us-central1-${projectId}.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const rawBody = await response.text();
  let body;
  try { body = JSON.parse(rawBody); } catch { body = {}; }
  if (!response.ok || body.error) throw new Error(`${name}: ${body.error?.status || response.status}`);
  if (!Object.prototype.hasOwnProperty.call(body, 'result')) throw new Error(`${name}: 応答形式が不正です。`);
  return body.result;
}
async function signIn() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!apiKey || !email || !password) throw new Error('.env.local の管理者認証設定が不足しています。');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok || !body.idToken) throw new Error('Firebase管理者認証に失敗しました。');
  return body.idToken;
}
async function writeAtomic(filename, data) {
  const temporary = `${filename}.${process.pid}.tmp`;
  await fs.writeFile(temporary, data, { mode: 0o600 });
  await fs.rename(temporary, filename);
}
function localMetadata(record) {
  const learnerKey = digest(`${projectId}:${record.uid}`).slice(0, 20);
  const { uid, attemptPath, attemptGroupId, image, ...rest } = record;
  return {
    ...rest, learnerKey, attemptGroupKey: digest(`${projectId}:${attemptGroupId}`).slice(0, 20),
    image: { filename: `answer.${image.contentType.split('/')[1] === 'jpeg' ? 'jpg' : image.contentType.split('/')[1]}`,
      contentType: image.contentType, bytes: image.bytes, sha256: image.sha256 },
  };
}
async function saveRecord(record, token, request = call, targetRoot = root) {
  const metadata = localMetadata(record);
  const directory = path.join(targetRoot,
    `subject=${segment(record.subject)}`, `field=${segment(record.field)}`,
    `unit=${segment(record.unitId)}`, `question=${segment(record.questionId)}`,
    `learner=${metadata.learnerKey}`, `attempt=${segment(record.attemptId)}`);
  if (!directory.startsWith(`${targetRoot}${path.sep}`)) throw new Error('保存先が不正です。');
  await fs.mkdir(directory, { recursive: true });
  const imagePath = path.join(directory, metadata.image.filename);
  const metadataPath = path.join(directory, 'record.json');
  let alreadySaved = false;
  try {
    const [existingImage, existingRecord] = await Promise.all([fs.readFile(imagePath), fs.readFile(metadataPath, 'utf8')]);
    alreadySaved = digest(existingImage) === record.image.sha256
      && JSON.parse(existingRecord).image.sha256 === record.image.sha256;
  } catch { /* 初回回収 */ }
  if (!alreadySaved) {
    const response = await request('getWrittenArchiveImage', { uid: record.uid, attemptId: record.attemptId }, token);
    const bytes = Buffer.from(response.base64, 'base64');
    if (digest(bytes) !== record.image.sha256 || response.sha256 !== record.image.sha256 || bytes.length !== record.image.bytes) {
      throw new Error('答案画像のハッシュまたは容量が一致しません。');
    }
    await writeAtomic(imagePath, bytes);
    await writeAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  }
  await request('acknowledgeWrittenArchive', {
    uid: record.uid, attemptId: record.attemptId, sha256: record.image.sha256,
  }, token);
  return alreadySaved ? 'verified' : 'downloaded';
}
async function rebuildCatalog() {
  const rows = [];
  async function walk(directory) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.name === 'record.json') {
        const record = JSON.parse(await fs.readFile(filename, 'utf8'));
        rows.push({ ...record, relativePath: path.relative(root, path.dirname(filename)).replaceAll('\\', '/') });
      }
    }
  }
  await walk(root);
  rows.sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)) || a.attemptId.localeCompare(b.attemptId));
  await writeAtomic(path.join(root, 'catalog.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  return rows.length;
}
async function syncExposures(token, request = call, targetRoot = root) {
  const exposureRoot = path.join(targetRoot, 'exposures');
  await fs.mkdir(exposureRoot, { recursive: true });
  let pageToken;
  let saved = 0;
  do {
    let result;
    try {
      result = await request('listWrittenResultExposures', { pageToken }, token);
    } catch (error) {
      if (!pageToken && error.message === 'listWrittenResultExposures: 404') {
        console.warn('表示記録の回収Functionは未配置です。答案回収とSQLite更新を続けます。');
        return 0;
      }
      throw error;
    }
    for (const record of result.records || []) {
      if (typeof record.uid !== 'string' || typeof record.attemptId !== 'string'
        || !/^[A-Za-z0-9_-]{1,128}$/.test(record.attemptId)) {
        throw new Error('表示記録の識別子が不正です。');
      }
      const filename = path.join(exposureRoot, `${digest(`${record.uid}:${record.attemptId}`)}.json`);
      let existing = {};
      try { existing = JSON.parse(await fs.readFile(filename, 'utf8')); } catch { /* 初回回収 */ }
      const local = {
        attemptId: record.attemptId,
        feedbackShownAt: existing.feedbackShownAt || record.feedbackShownAt || null,
        modelAnswerShownAt: existing.modelAnswerShownAt || record.modelAnswerShownAt || null,
      };
      await writeAtomic(filename, `${JSON.stringify(local)}\n`);
      await request('acknowledgeWrittenResultExposure', record, token);
      saved += 1;
    }
    pageToken = result.nextPageToken || undefined;
  } while (pageToken);
  return saved;
}
async function countPendingArchives(token) {
  let pageToken;
  let pending = 0;
  do {
    const result = await call('listWrittenArchiveRecords', { pageToken }, token);
    pending += result.records?.length || 0;
    pageToken = result.nextPageToken || undefined;
  } while (pageToken);
  return pending;
}
async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: npm.cmd run archive:written:pull [-- --unit-id ID --attempt-id ID]');
    return;
  }
  const unitOption = process.argv.indexOf('--unit-id');
  const attemptOption = process.argv.indexOf('--attempt-id');
  if ((unitOption < 0) !== (attemptOption < 0)) throw new Error('試験回収では単元IDと答案IDを両方指定してください。');
  const targetUnitId = unitOption >= 0 ? process.argv[unitOption + 1] : null;
  const targetAttemptId = attemptOption >= 0 ? process.argv[attemptOption + 1] : null;
  if ((unitOption >= 0 && !targetUnitId) || (attemptOption >= 0 && !targetAttemptId)) {
    throw new Error('試験回収の単元ID・答案IDが不足しています。');
  }
  const token = await signIn();
  await fs.mkdir(root, { recursive: true });
  let pageToken;
  let downloaded = 0;
  let verified = 0;
  do {
    const result = await call('listWrittenArchiveRecords', { pageToken }, token);
    for (const record of result.records || []) {
      if (targetUnitId && (record.unitId !== targetUnitId || record.attemptId !== targetAttemptId)) continue;
      const state = await saveRecord(record, token);
      if (state === 'downloaded') downloaded += 1;
      else verified += 1;
    }
    if (result.records?.length) {
      console.log(`答案回収進行: 今回処理=${downloaded + verified}件`);
    }
    pageToken = result.nextPageToken || undefined;
  } while (pageToken);
  const total = await rebuildCatalog();
  const exposures = await syncExposures(token);
  const { build } = require('./build-written-analysis-db');
  const index = build();
  const { checkArchive } = require('./check-written-analysis-archive');
  const health = checkArchive();
  const pending = await countPendingArchives(token);
  console.log(`答案回収: 新規=${downloaded}, 照合済み=${verified}, ローカル総数=${total}, 表示記録=${exposures}`);
  console.log(`分析DB: 答案=${index.attempts}, 表示記録=${index.exposures}`);
  console.log(`アーカイブ検証: ${health.status}, 1・2回目の結合可能グループ=${health.counts.pairedGroups}`);
  console.log(`クラウド一時保管の残件=${pending}`);
  console.log(`保存先: ${root}`);
  if (pending > 0) process.exitCode = 1;
}
if (require.main === module) {
  main().catch(error => { console.error(`答案回収に失敗しました: ${error.message}`); process.exitCode = 1; });
}

module.exports = { segment, localMetadata, saveRecord, rebuildCatalog, syncExposures };
