const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

let admin = null;
try {
  admin = require('firebase-admin');
} catch {
  admin = null;
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'math-app-26c77';
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const adminEmail = process.env.TEST_USER_EMAIL;
const adminPassword = process.env.TEST_USER_PASSWORD;

function ensureConfig() {
  if (!apiKey || !adminEmail || !adminPassword) {
    throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY / TEST_USER_EMAIL / TEST_USER_PASSWORD が必要です。');
  }
}

async function signInWithPassword() {
  ensureConfig();

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
        returnSecureToken: true,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firebase Auth login failed: ${text}`);
  }

  const data = await response.json();
  return data.idToken;
}

function parseFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue || 0);
  if ('doubleValue' in value) return Number(value.doubleValue || 0);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('mapValue' in value) {
    const out = {};
    const fields = value.mapValue.fields || {};
    Object.entries(fields).forEach(([key, child]) => {
      out[key] = parseFirestoreValue(child);
    });
    return out;
  }
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(parseFirestoreValue);
  }
  return null;
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    Object.entries(value).forEach(([key, child]) => {
      fields[key] = encodeFirestoreValue(child);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function parseDocument(doc) {
  const fields = doc.fields || {};
  const data = {};
  Object.entries(fields).forEach(([key, value]) => {
    data[key] = parseFirestoreValue(value);
  });
  const nameParts = doc.name.split('/');
  return { id: nameParts[nameParts.length - 1], path: doc.name, data };
}

async function listDocuments(idToken, collectionId) {
  const documents = [];
  let pageToken = null;

  while (true) {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}`
    );
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Firestore listDocuments(${collectionId}) failed: ${text}`);
    }

    const data = await response.json();
    (data.documents || []).forEach((doc) => documents.push(parseDocument(doc)));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return documents;
}

async function runCollectionGroupQuery(idToken, collectionId) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId, allDescendants: true }],
        },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firestore runQuery(${collectionId}) failed: ${text}`);
  }

  const rows = await response.json();
  return rows
    .filter((row) => row.document)
    .map((row) => parseDocument(row.document));
}

function aggregateAttemptXp(attemptDocs) {
  const totals = new Map();

  attemptDocs.forEach((doc) => {
    const data = doc.data;
    const pathParts = doc.path.split('/');
    const usersIndex = pathParts.indexOf('users');
    const uidFromPath = usersIndex >= 0 ? pathParts[usersIndex + 1] : null;
    const uid = data.uid || uidFromPath;
    if (!uid) return;

    const xpGain = Number(data.xpGain || 0);
    if (!Number.isFinite(xpGain) || xpGain <= 0) return;

    const current = totals.get(uid) || { xp: 0, attemptsCount: 0 };
    current.xp += xpGain;
    current.attemptsCount += 1;
    totals.set(uid, current);
  });

  return totals;
}

async function auditViaRest() {
  const idToken = await signInWithPassword();
  const [userDocs, attemptDocs] = await Promise.all([
    listDocuments(idToken, 'users'),
    runCollectionGroupQuery(idToken, 'attempts'),
  ]);

  const attemptTotals = aggregateAttemptXp(attemptDocs);
  const mismatches = [];

  userDocs.forEach((userDoc) => {
    const data = userDoc.data;
    const storedXp = Number(data.xp || 0);
    const aggregate = attemptTotals.get(userDoc.id) || { xp: 0, attemptsCount: 0 };
    const delta = storedXp - aggregate.xp;

    if (delta !== 0) {
      mismatches.push({
        uid: userDoc.id,
        displayName: data.displayName || '',
        storedXp,
        attemptsXp: aggregate.xp,
        delta,
        attemptsCount: aggregate.attemptsCount,
        level: Number(data.level || 1),
        totalScore: Number(data.totalScore || 0),
      });
    }
  });

  return { mismatches, checkedUsers: userDocs.length, attemptsCount: attemptDocs.length };
}

async function auditViaAdmin() {
  if (!admin) {
    throw new Error('firebase-admin が使えません。');
  }
  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }
  const db = admin.firestore();

  async function sumAttemptXp(userRef) {
    let total = 0;
    const attemptsSnap = await userRef.collection('attempts').get();
    attemptsSnap.forEach((doc) => {
      const xpGain = Number(doc.data().xpGain || 0);
      if (Number.isFinite(xpGain) && xpGain > 0) total += xpGain;
    });
    return { total, attemptsCount: attemptsSnap.size };
  }

  const usersSnap = await db.collection('users').get();
  const mismatches = [];
  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const storedXp = Number(data.xp || 0);
    const { total: attemptsXp, attemptsCount } = await sumAttemptXp(userDoc.ref);
    const delta = storedXp - attemptsXp;
    if (delta !== 0) {
      mismatches.push({
        uid: userDoc.id,
        displayName: data.displayName || '',
        storedXp,
        attemptsXp,
        delta,
        attemptsCount,
        level: Number(data.level || 1),
        totalScore: Number(data.totalScore || 0),
      });
    }
  }
  return { mismatches, checkedUsers: usersSnap.size, attemptsCount: null };
}

async function main() {
  console.log('--- XP整合性チェック開始 ---');

  let result;
  try {
    result = await auditViaAdmin();
    console.log('認証方式: firebase-admin');
  } catch (adminErr) {
    result = await auditViaRest();
    console.log('認証方式: Firebase Auth + Firestore REST');
  }

  const { mismatches, checkedUsers, attemptsCount } = result;
  console.log(`対象ユーザー数: ${checkedUsers} 名`);
  if (attemptsCount !== null) {
    console.log(`対象attempt数: ${attemptsCount} 件`);
  }

  mismatches.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  console.log('');
  console.log(`不一致ユーザー数: ${mismatches.length} 名`);

  if (mismatches.length === 0) {
    console.log('XPの不一致は見つかりませんでした。');
    return;
  }

  console.log('');
  console.log('差分上位一覧:');
  mismatches.slice(0, 50).forEach((item, index) => {
    console.log(
      `${index + 1}. ${item.displayName || '(no name)'} (${item.uid})` +
      ` | users.xp=${item.storedXp}` +
      ` | attempts合計=${item.attemptsXp}` +
      ` | 差分=${item.delta}` +
      ` | attempts=${item.attemptsCount}` +
      ` | level=${item.level}` +
      ` | totalScore=${item.totalScore}`
    );
  });

  console.log('');
  console.log('JSON:');
  console.log(JSON.stringify(mismatches, null, 2));
}

main().catch((err) => {
  console.error('監査に失敗しました:', err);
  process.exit(1);
});
