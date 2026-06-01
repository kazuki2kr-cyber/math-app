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
const isDryRun = process.argv.includes('--dry-run');
const MAX_LEVEL = 100;
const LEVEL_XP_CAP_LEVEL = 40;

function ensureConfig() {
  if (!apiKey || !adminEmail || !adminPassword) {
    throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY / TEST_USER_EMAIL / TEST_USER_PASSWORD が必要です。');
  }
}

function calculateLevelAndProgress(totalXp) {
  let level = 1;
  let accumulatedXp = 0;

  while (level < MAX_LEVEL) {
    const cappedLevel = Math.min(level, LEVEL_XP_CAP_LEVEL);
    const xpForNext = Math.floor(2.2 * Math.pow(cappedLevel, 2)) + 50;
    if (totalXp >= accumulatedXp + xpForNext) {
      accumulatedXp += xpForNext;
      level++;
    } else {
      const currentLevelXp = totalXp - accumulatedXp;
      const progressPercent = Math.min(100, Math.max(0, (currentLevelXp / xpForNext) * 100));
      return { level, currentLevelXp, nextLevelXp: xpForNext, progressPercent };
    }
  }

  return { level: MAX_LEVEL, currentLevelXp: 0, nextLevelXp: 0, progressPercent: 100 };
}

function getTitleForLevel(level) {
  if (level >= 100) return 'Grandmaster';
  if (level >= 90) return '数学のオイラー';
  if (level >= 80) return '数学の星';
  if (level >= 70) return '数学マスター';
  if (level >= 60) return '数学の賢者';
  if (level >= 50) return '化学の数学ハンター';
  if (level >= 40) return '数学のひらめき';
  if (level >= 30) return '電気の計算職人';
  if (level >= 20) return '計算の達人';
  if (level >= 10) return '数学ビギナー';
  return '算数勉強中';
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

async function patchDocument(idToken, documentPath, data) {
  if (isDryRun) return;

  const updateMask = Object.keys(data).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
  const response = await fetch(
    `https://firestore.googleapis.com/v1/${documentPath}?${updateMask}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: Object.fromEntries(
          Object.entries(data).map(([key, value]) => [key, encodeFirestoreValue(value)])
        ),
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PATCH ${documentPath} failed: ${text}`);
  }
}

async function repairViaRest() {
  const idToken = await signInWithPassword();
  const [userDocs, attemptDocs] = await Promise.all([
    listDocuments(idToken, 'users'),
    runCollectionGroupQuery(idToken, 'attempts'),
  ]);

  const attemptTotals = aggregateAttemptXp(attemptDocs);
  const mismatches = [];
  const patchedUsers = new Map();

  for (const userDoc of userDocs) {
    const data = userDoc.data;
    const storedXp = Number(data.xp || 0);
    const aggregate = attemptTotals.get(userDoc.id) || { xp: 0, attemptsCount: 0 };
    if (storedXp === aggregate.xp) {
      patchedUsers.set(userDoc.id, { ...data, xp: storedXp });
      continue;
    }

    const levelData = calculateLevelAndProgress(aggregate.xp);
    const updatedUser = {
      ...data,
      xp: aggregate.xp,
      level: levelData.level,
      title: getTitleForLevel(levelData.level),
      progressPercent: levelData.progressPercent,
      currentLevelXp: levelData.currentLevelXp,
      nextLevelXp: levelData.nextLevelXp,
      updatedAt: new Date().toISOString(),
    };

    mismatches.push({
      uid: userDoc.id,
      displayName: data.displayName || '',
      storedXp,
      recalculatedXp: aggregate.xp,
      delta: storedXp - aggregate.xp,
      attemptsCount: aggregate.attemptsCount,
      level: levelData.level,
    });

    console.log(
      `${data.displayName || '(no name)'} (${userDoc.id})` +
      ` | users.xp=${storedXp}` +
      ` -> recalculated=${aggregate.xp}` +
      ` | delta=${storedXp - aggregate.xp}`
    );

    await patchDocument(idToken, userDoc.path, {
      xp: aggregate.xp,
      level: levelData.level,
      title: getTitleForLevel(levelData.level),
      progressPercent: levelData.progressPercent,
      currentLevelXp: levelData.currentLevelXp,
      nextLevelXp: levelData.nextLevelXp,
      updatedAt: updatedUser.updatedAt,
    });

    patchedUsers.set(userDoc.id, updatedUser);
  }

  const allPlayers = [];
  for (const userDoc of userDocs) {
    const data = patchedUsers.get(userDoc.id) || userDoc.data;
    if ((data.totalScore && data.totalScore > 0) || (data.xp && data.xp > 0)) {
      allPlayers.push({
        uid: userDoc.id,
        name: data.displayName || data.email || '名無し',
        totalScore: Number(data.totalScore || 0),
        xp: Number(data.xp || 0),
        icon: data.icon || '📐',
        level: Number(data.level || 1),
      });
    }
  }

  allPlayers.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return b.xp - a.xp;
  });

  const top40 = allPlayers.slice(0, 40);
  const statsDocs = await listDocuments(idToken, 'stats');
  const globalStats = statsDocs.find((doc) => doc.id === 'global');
  const totalParticipants = globalStats
    ? Number(globalStats.data.totalParticipants || allPlayers.length)
    : allPlayers.length;

  await patchDocument(
    idToken,
    `projects/${projectId}/databases/(default)/documents/leaderboards/overall`,
    {
      rankings: top40,
      totalParticipants,
      updatedAt: new Date().toISOString(),
    }
  );

  return { mismatches, top40Count: top40.length };
}

async function repairViaAdmin() {
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
    return total;
  }

  const usersSnap = await db.collection('users').get();
  const mismatches = [];

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const recalculatedXp = await sumAttemptXp(userDoc.ref);
    const storedXp = Number(data.xp || 0);

    if (storedXp === recalculatedXp) continue;

    const levelData = calculateLevelAndProgress(recalculatedXp);
    mismatches.push({
      uid: userDoc.id,
      displayName: data.displayName || '',
      storedXp,
      recalculatedXp,
      delta: storedXp - recalculatedXp,
      level: levelData.level,
    });

    console.log(
      `${data.displayName || '(no name)'} (${userDoc.id})` +
      ` | users.xp=${storedXp}` +
      ` -> recalculated=${recalculatedXp}` +
      ` | delta=${storedXp - recalculatedXp}`
    );

    if (!isDryRun) {
      await userDoc.ref.update({
        xp: recalculatedXp,
        level: levelData.level,
        title: getTitleForLevel(levelData.level),
        progressPercent: levelData.progressPercent,
        currentLevelXp: levelData.currentLevelXp,
        nextLevelXp: levelData.nextLevelXp,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  const refreshedUsersSnap = await db.collection('users').get();
  const allPlayers = [];
  refreshedUsersSnap.forEach((doc) => {
    const data = doc.data();
    if ((data.totalScore && data.totalScore > 0) || (data.xp && data.xp > 0)) {
      allPlayers.push({
        uid: doc.id,
        name: data.displayName || data.email || '名無し',
        totalScore: Number(data.totalScore || 0),
        xp: Number(data.xp || 0),
        icon: data.icon || '📐',
        level: Number(data.level || 1),
      });
    }
  });

  allPlayers.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return b.xp - a.xp;
  });

  const top40 = allPlayers.slice(0, 40);
  const globalStatsSnap = await db.doc('stats/global').get();
  const totalParticipants = globalStatsSnap.exists
    ? Number(globalStatsSnap.data().totalParticipants || allPlayers.length)
    : allPlayers.length;

  if (!isDryRun) {
    await db.doc('leaderboards/overall').set({
      rankings: top40,
      totalParticipants,
      updatedAt: new Date().toISOString(),
    });
  }

  return { mismatches, top40Count: top40.length };
}

async function main() {
  console.log(`--- XP修復開始 (${isDryRun ? 'DRY-RUN' : 'REAL'}) ---`);

  let result;
  try {
    result = await repairViaAdmin();
    console.log('認証方式: firebase-admin');
  } catch (adminErr) {
    result = await repairViaRest();
    console.log('認証方式: Firebase Auth + Firestore REST');
  }

  console.log('');
  console.log(`修復対象ユーザー数: ${result.mismatches.length}`);
  console.log(`leaderboards/overall 再構築対象: ${result.top40Count} 名`);

  if (result.mismatches.length === 0) {
    console.log('XP修復は不要でした。');
    return;
  }

  console.log('');
  console.log('修復結果JSON:');
  console.log(JSON.stringify(result.mismatches, null, 2));
}

main().catch((err) => {
  console.error('修復に失敗しました:', err);
  process.exit(1);
});
