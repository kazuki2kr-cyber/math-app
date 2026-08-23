'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Node運用スクリプトは既存のCommonJS実行環境に合わせる。 */

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const {
  buildSnapshot,
  buildWeeklyWindows,
  dateKeyToInstant,
  toDateKeyInTokyo,
} = require('./lib/weekly-automation-snapshot');

const DEFAULT_PROJECT_ID = 'math-app-26c77';
const DEFAULT_OUTPUT = '.local/automation/formix-weekly-snapshot.json';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local'), quiet: true });

function parseArgs(argv) {
  const options = {
    asOfDate: toDateKeyInTokyo(),
    output: DEFAULT_OUTPUT,
    projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || DEFAULT_PROJECT_ID,
    strict: false,
    checkAuth: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--strict') {
      options.strict = true;
    } else if (argument === '--check-auth') {
      options.checkAuth = true;
    } else if (argument === '--as-of' || argument === '--output' || argument === '--project-id') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} の値が必要です。`);
      index += 1;
      if (argument === '--as-of') options.asOfDate = value;
      if (argument === '--output') options.output = value;
      if (argument === '--project-id') options.projectId = value;
    } else if (argument === '--help') {
      options.help = true;
    } else {
      throw new Error(`不明な引数です: ${argument}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/generate-weekly-automation-snapshot.js [options]

Options:
  --as-of YYYY-MM-DD   集計基準日（日本時間、既定: 今日）
  --output PATH        JSON出力先（既定: ${DEFAULT_OUTPUT}）
  --project-id ID      Firebase project ID（既定: ${DEFAULT_PROJECT_ID}）
  --check-auth         データを保存せず認証・読み取り権限だけを確認
  --strict             一部の取得失敗でも終了コードを1にする
  --help               このヘルプを表示`);
}

function safeError(source, error) {
  const code = typeof error?.code === 'string' ? error.code : 'unknown';
  const messages = {
    '7 PERMISSION_DENIED': 'Firestoreの読み取り権限がありません。',
    'permission-denied': 'Firestoreの読み取り権限がありません。',
    '5 NOT_FOUND': '対象データが見つかりません。',
    'app/invalid-credential': 'Application Default Credentialsを確認してください。',
    'http_400': '.env.local のFirebaseテスト認証情報が拒否されました。APIキー・メール・パスワードを再確認してください。',
    'auth/invalid-login-credentials': '.env.local のFirebaseテスト認証情報が拒否されました。メール・パスワードを再確認してください。',
    'auth/user-disabled': 'Firebaseテスト利用者が無効です。Auth設定を確認してください。',
    'auth/api-key-invalid': 'Firebase APIキーが無効、または対象プロジェクトと一致しません。',
    'auth/request-blocked': 'Firebase APIキーの利用制限により、この実行環境からの認証が拒否されました。',
    'auth/adc-missing': 'Application Default Credentialsが設定されていません。',
    'auth/config-missing': '.env.local にFirebaseテスト認証情報が揃っていません。',
    'network/fetch-failed': 'Firebaseへのネットワーク接続に失敗しました。',
  };
  return {
    source,
    code,
    message: messages[code] || 'データを取得できませんでした。認証と対象データを確認してください。',
  };
}

async function readDoc(db, documentPath) {
  const snapshot = await db.doc(documentPath).get();
  if (!snapshot.exists) throw Object.assign(new Error('not found'), { code: '5 NOT_FOUND' });
  return snapshot.data();
}

function parseFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.hasOwn(value, 'stringValue')) return value.stringValue;
  if (Object.hasOwn(value, 'integerValue')) return Number(value.integerValue || 0);
  if (Object.hasOwn(value, 'doubleValue')) return Number(value.doubleValue || 0);
  if (Object.hasOwn(value, 'booleanValue')) return Boolean(value.booleanValue);
  if (Object.hasOwn(value, 'timestampValue')) return value.timestampValue;
  if (Object.hasOwn(value, 'nullValue')) return null;
  if (value.mapValue) {
    return Object.fromEntries(Object.entries(value.mapValue.fields || {})
      .map(([key, child]) => [key, parseFirestoreValue(child)]));
  }
  if (value.arrayValue) return (value.arrayValue.values || []).map(parseFirestoreValue);
  return null;
}

function parseRestDocument(document) {
  return Object.fromEntries(Object.entries(document?.fields || {})
    .map(([key, value]) => [key, parseFirestoreValue(value)]));
}

function firestoreRestBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)`;
}

async function fetchJson(url, init, errorPrefix) {
  const response = await fetch(url, init);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${errorPrefix} failed`);
    const remoteMessage = String(result?.error?.message || '').toUpperCase();
    if (errorPrefix === 'firebase_auth') {
      if (remoteMessage.includes('INVALID_LOGIN_CREDENTIALS') || remoteMessage.includes('PASSWORD')) {
        error.code = 'auth/invalid-login-credentials';
      } else if (remoteMessage.includes('USER_DISABLED')) {
        error.code = 'auth/user-disabled';
      } else if (remoteMessage.includes('API KEY') && remoteMessage.includes('INVALID')) {
        error.code = 'auth/api-key-invalid';
      } else if (remoteMessage.includes('BLOCK') || response.status === 403) {
        error.code = 'auth/request-blocked';
      }
    }
    error.code ||= `http_${response.status}`;
    throw error;
  }
  return result;
}

async function signInForRest() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!apiKey || !email || !password) {
    const error = new Error('Firebase Auth configuration is incomplete');
    error.code = 'auth/config-missing';
    throw error;
  }
  const result = await fetchJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
    'firebase_auth',
  );
  if (!result.idToken) {
    const error = new Error('Firebase Auth did not return a token');
    error.code = 'auth/token-missing';
    throw error;
  }
  return result.idToken;
}

function restHeaders(idToken) {
  return { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
}

function encodeDocumentPath(documentPath) {
  return documentPath.split('/').map(encodeURIComponent).join('/');
}

function hasApplicationDefaultCredentials() {
  const configuredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (configuredPath && fsSync.existsSync(path.resolve(configuredPath))) return true;
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json'),
    path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json'),
  ].filter(Boolean);
  return candidates.some((candidate) => fsSync.existsSync(candidate));
}

async function readRestDoc(projectId, idToken, documentPath) {
  const result = await fetchJson(
    `${firestoreRestBase(projectId)}/documents/${encodeDocumentPath(documentPath)}`,
    { headers: restHeaders(idToken) },
    'firestore_document_read',
  );
  return parseRestDocument(result);
}

async function readRestCollection(projectId, idToken, collectionPath) {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(`${firestoreRestBase(projectId)}/documents/${encodeDocumentPath(collectionPath)}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const result = await fetchJson(url, { headers: restHeaders(idToken) }, 'firestore_collection_read');
    documents.push(...(result.documents || []).map(parseRestDocument));
    pageToken = result.nextPageToken || '';
  } while (pageToken);
  return documents;
}

async function readRestFeedback(projectId, idToken, collectionName, startDate, endExclusive) {
  const result = await fetchJson(
    `${firestoreRestBase(projectId)}/documents:runQuery`,
    {
      method: 'POST',
      headers: restHeaders(idToken),
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: collectionName }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: 'createdAt' },
                    op: 'GREATER_THAN_OR_EQUAL',
                    value: { timestampValue: dateKeyToInstant(startDate).toISOString() },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: 'createdAt' },
                    op: 'LESS_THAN',
                    value: { timestampValue: dateKeyToInstant(endExclusive).toISOString() },
                  },
                },
              ],
            },
          },
          orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
        },
      }),
    },
    'firestore_feedback_query',
  );
  return result.filter((row) => row.document).map((row) => parseRestDocument(row.document));
}

async function createDataSource(projectId) {
  let restError = null;
  try {
    const idToken = await signInForRest();
    await readRestDoc(projectId, idToken, 'public_analytics_serving/current/manifest/current');
    return {
      authentication: 'firebase-auth-admin-rules',
      readDoc: (documentPath) => readRestDoc(projectId, idToken, documentPath),
      readCollection: (collectionPath) => readRestCollection(projectId, idToken, collectionPath),
      readFeedback: (collectionName, startDate, endExclusive) => readRestFeedback(
        projectId, idToken, collectionName, startDate, endExclusive,
      ),
    };
  } catch (error) {
    restError = error;
  }

  try {
    if (!hasApplicationDefaultCredentials()) {
      const missingAdc = new Error('Application Default Credentials are not configured');
      missingAdc.code = 'auth/adc-missing';
      throw missingAdc;
    }
    if (!admin.apps.length) admin.initializeApp({ projectId });
    const db = admin.firestore();
    await db.doc('public_analytics_serving/current/manifest/current').get();
    return {
      authentication: 'application-default-credentials',
      readDoc: (documentPath) => readDoc(db, documentPath),
      readCollection: (collectionPath) => readCollection(db, collectionPath),
      readFeedback: (collectionName, startDate, endExclusive) => readFeedback(
        db, collectionName, startDate, endExclusive,
      ),
    };
  } catch (adminError) {
    const error = new Error('No usable read-only authentication path');
    error.code = restError?.code
      || (restError?.name === 'TypeError' ? 'network/fetch-failed' : null)
      || adminError?.code
      || 'auth/unavailable';
    throw error;
  }
}

async function readCollection(db, collectionPath) {
  const snapshot = await db.collection(collectionPath).get();
  return snapshot.docs.map((document) => document.data());
}

async function readFeedback(db, collectionName, startDate, endExclusive) {
  const start = admin.firestore.Timestamp.fromDate(dateKeyToInstant(startDate));
  const end = admin.firestore.Timestamp.fromDate(dateKeyToInstant(endExclusive));
  const snapshot = await db.collection(collectionName)
    .where('createdAt', '>=', start)
    .where('createdAt', '<', end)
    .orderBy('createdAt', 'asc')
    .get();
  return snapshot.docs.map((document) => document.data());
}

async function settle(source, operation, errors, fallback) {
  try {
    return await operation();
  } catch (error) {
    errors.push(safeError(source, error));
    return fallback;
  }
}

async function writeJsonAtomically(outputPath, value) {
  const workspaceRoot = path.resolve(__dirname, '..');
  const allowedRoot = path.resolve(workspaceRoot, '.local', 'automation');
  const resolved = path.resolve(workspaceRoot, outputPath);
  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error('出力先は .local/automation 以下を指定してください。');
  }
  const directory = path.dirname(resolved);
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, resolved);
  return resolved;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const windows = buildWeeklyWindows(options.asOfDate);
  if (options.checkAuth) {
    try {
      const checkedSource = await createDataSource(options.projectId);
      console.log(`authentication=${checkedSource.authentication}, status=ready`);
    } catch (error) {
      const safe = safeError('authentication', error);
      console.error(`authentication=${safe.code}, status=failed: ${safe.message}`);
      process.exitCode = 1;
    }
    return;
  }
  const errors = [];
  let dataSource;
  try {
    dataSource = await createDataSource(options.projectId);
  } catch (error) {
    errors.push(safeError('authentication', error));
    dataSource = {
      authentication: 'unavailable',
      readDoc: async () => ({}),
      readCollection: async () => [],
      readFeedback: async () => [],
    };
  }
  const [overview, trends, categories, generalFeedback, writtenFeedback] = await Promise.all([
    settle('public_analytics_serving/report_overview', () => dataSource.readDoc(
      'public_analytics_serving/current/report_overview/current'), errors, {}),
    settle('public_analytics_serving/report_trends', () => dataSource.readDoc(
      'public_analytics_serving/current/report_trends/current'), errors, { days: [] }),
    settle('public_analytics_serving/report_categories', () => dataSource.readCollection(
      'public_analytics_serving/current/report_categories'), errors, []),
    settle('user_feedback', () => dataSource.readFeedback('user_feedback',
      windows.current.startDate, windows.current.endExclusive), errors, []),
    settle('written_grading_feedback', () => dataSource.readFeedback('written_grading_feedback',
      windows.current.startDate, windows.current.endExclusive), errors, []),
  ]);

  const snapshot = buildSnapshot({
    asOfDate: options.asOfDate,
    projectId: options.projectId,
    overview,
    trends,
    categories,
    generalFeedback,
    writtenFeedback,
    errors,
  });
  snapshot.authentication = dataSource.authentication;
  const writtenPath = await writeJsonAtomically(options.output, snapshot);
  console.log(`週次automation入力JSONを保存しました: ${writtenPath}`);
  console.log(`status=${snapshot.status}, feedback=${snapshot.feedback.summary.total}, errors=${errors.length}`);
  if (options.strict && errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(safeError('weekly_snapshot', error).message);
  process.exitCode = 1;
});
