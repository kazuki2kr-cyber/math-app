const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const dotenv = require('dotenv');
const admin = require('firebase-admin');

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'math-app-26c77';
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const adminEmail = process.env.TEST_USER_EMAIL;
const adminPassword = process.env.TEST_USER_PASSWORD;
const isApply = process.argv.includes('--apply');
const includeAllUsers = process.argv.includes('--all');
const MAX_LEVEL = 100;
const LEVEL_XP_CAP_LEVEL = 40;

function getXpForNextLevel(level) {
  const cappedLevel = Math.min(level, LEVEL_XP_CAP_LEVEL);
  return Math.floor(2.2 * Math.pow(cappedLevel, 2)) + 50;
}

function calculateLevelAndProgress(totalXp) {
  let level = 1;
  let accumulatedXp = 0;

  while (level < MAX_LEVEL) {
    const xpForNext = getXpForNextLevel(level);
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
  if (level >= 90) return '次世代のオイラー';
  if (level >= 80) return '数学の覇者';
  if (level >= 70) return '数学マスター';
  if (level >= 60) return '数学の賢者';
  if (level >= 50) return '芝浦の数理ハンター';
  if (level >= 40) return '数学のひらめき';
  if (level >= 30) return '論理の探求者';
  if (level >= 20) return '計算の達人';
  if (level >= 10) return '数学ビギナー';
  return '算数卒業生';
}

function differsNumber(current, next) {
  const numeric = Number(current);
  if (!Number.isFinite(numeric)) return true;
  return Math.abs(numeric - next) > 0.000001;
}

function levelFieldsDiffer(data, levelData, title) {
  return (
    Number(data.level || 1) !== levelData.level ||
    data.title !== title ||
    differsNumber(data.progressPercent, levelData.progressPercent) ||
    differsNumber(data.currentLevelXp, levelData.currentLevelXp) ||
    differsNumber(data.nextLevelXp, levelData.nextLevelXp)
  );
}

function shouldConsiderUser(data, nextLevel) {
  if (includeAllUsers) return true;
  return Number(data.level || 1) >= LEVEL_XP_CAP_LEVEL || nextLevel >= LEVEL_XP_CAP_LEVEL;
}

async function commitBatch(db, writes) {
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    writes.slice(i, i + 450).forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }
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
    Object.entries(value.mapValue.fields || {}).forEach(([key, child]) => {
      out[key] = parseFirestoreValue(child);
    });
    return out;
  }
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(parseFirestoreValue);
  }
  return null;
}

function parseDocument(doc) {
  const data = {};
  Object.entries(doc.fields || {}).forEach(([key, value]) => {
    data[key] = parseFirestoreValue(value);
  });
  const parts = doc.name.split('/');
  return { id: parts[parts.length - 1], path: doc.name, data };
}

function ensureRestConfig() {
  if (!apiKey || !adminEmail || !adminPassword) {
    throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY, TEST_USER_EMAIL, and TEST_USER_PASSWORD are required for REST fallback.');
  }
}

async function signInWithPassword() {
  ensureRestConfig();
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
    throw new Error(`Firebase Auth login failed: ${await response.text()}`);
  }
  return (await response.json()).idToken;
}

async function getBearerToken() {
  try {
    const output = execFileSync(process.env.ComSpec || 'cmd.exe', ['/c', 'npx.cmd', '--yes', 'firebase-tools', 'login:list', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const body = JSON.parse(output);
    const token = body?.result?.[0]?.tokens?.access_token;
    if (token) return token;
  } catch {
    // Fall through to Firebase Auth password login for older local setups.
  }

  return await signInWithPassword();
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
      throw new Error(`Firestore listDocuments(${collectionId}) failed: ${await response.text()}`);
    }
    const body = await response.json();
    (body.documents || []).forEach((doc) => documents.push(parseDocument(doc)));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return documents;
}

async function getDocument(idToken, documentPath) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/${documentPath}`,
    { headers: { Authorization: `Bearer ${idToken}` } }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Firestore getDocument(${documentPath}) failed: ${await response.text()}`);
  }
  return parseDocument(await response.json());
}

async function patchDocument(idToken, documentPath, data) {
  const url = new URL(`https://firestore.googleapis.com/v1/${documentPath}`);
  Object.keys(data).forEach((field) => url.searchParams.append('updateMask.fieldPaths', field));
  const fields = {};
  Object.entries(data).forEach(([key, value]) => {
    fields[key] = encodeFirestoreValue(value);
  });
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    throw new Error(`Firestore patchDocument(${documentPath}) failed: ${await response.text()}`);
  }
}

function buildPlan(users, now) {
  const updates = [];
  const leaderboardPlayers = [];

  users.forEach((user) => {
    const data = user.data;
    const xp = Math.max(0, Number(data.xp || 0));
    const levelData = calculateLevelAndProgress(xp);
    const title = getTitleForLevel(levelData.level);

    if ((Number(data.totalScore || 0) > 0) || xp > 0) {
      leaderboardPlayers.push({
        uid: user.id,
        name: data.displayName || data.email || 'unknown',
        totalScore: Number(data.totalScore || 0),
        xp,
        icon: data.icon || '',
        level: levelData.level,
      });
    }

    if (!shouldConsiderUser(data, levelData.level)) return;
    if (!levelFieldsDiffer(data, levelData, title)) return;

    updates.push({
      uid: user.id,
      displayName: data.displayName || data.email || '',
      xp,
      oldLevel: Number(data.level || 1),
      newLevel: levelData.level,
      oldNextLevelXp: Number(data.nextLevelXp || 0),
      newNextLevelXp: levelData.nextLevelXp,
      ref: user.ref,
      path: user.path,
      data: {
        level: levelData.level,
        title,
        progressPercent: levelData.progressPercent,
        currentLevelXp: levelData.currentLevelXp,
        nextLevelXp: levelData.nextLevelXp,
        updatedAt: now,
      },
    });
  });

  leaderboardPlayers.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return b.xp - a.xp;
  });

  const top40 = leaderboardPlayers.slice(0, 40);
  return { updates, leaderboardPlayers, top40 };
}

function printPlan(source, checkedUsers, updates) {
  console.log(`Math level recalculation (${isApply ? 'APPLY' : 'DRY-RUN'}) via ${source}`);
  console.log(`Checked users: ${checkedUsers}`);
  console.log(`Pending user updates: ${updates.length}`);
  console.log(JSON.stringify(updates.map(({ ref, data, path, ...item }) => item), null, 2));
}

async function runViaAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }

  const db = admin.firestore();
  const now = new Date().toISOString();
  const usersSnap = await db.collection('users').get();
  const users = usersSnap.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    data: doc.data(),
  }));
  const { updates, leaderboardPlayers, top40 } = buildPlan(users, now);

  printPlan('firebase-admin', usersSnap.size, updates);

  if (!isApply) {
    console.log('No writes performed. Re-run with --apply to update Firestore.');
    return { updatedUsers: 0, top40Count: top40.length };
  }

  await commitBatch(db, updates);
  const globalStatsSnap = await db.doc('stats/global').get();
  const totalParticipants = globalStatsSnap.exists
    ? Number(globalStatsSnap.data().totalParticipants || leaderboardPlayers.length)
    : leaderboardPlayers.length;

  await db.doc('leaderboards/overall').set(
    {
      rankings: top40,
      totalParticipants,
      updatedAt: now,
    },
    { merge: true }
  );

  console.log(`Updated users: ${updates.length}`);
  console.log(`Updated leaderboards/overall rankings: ${top40.length}`);
  return { updatedUsers: updates.length, top40Count: top40.length };
}

async function runViaRest() {
  const idToken = await getBearerToken();
  const now = new Date().toISOString();
  const userDocs = await listDocuments(idToken, 'users');
  const users = userDocs.map((doc) => ({
    id: doc.id,
    path: doc.path,
    data: doc.data,
  }));
  const { updates, leaderboardPlayers, top40 } = buildPlan(users, now);

  printPlan('Firebase Auth REST', users.length, updates);

  if (!isApply) {
    console.log('No writes performed. Re-run with --apply to update Firestore.');
    return { updatedUsers: 0, top40Count: top40.length };
  }

  for (const update of updates) {
    await patchDocument(idToken, update.path, update.data);
  }

  const globalStats = await getDocument(
    idToken,
    `projects/${projectId}/databases/(default)/documents/stats/global`
  );
  const totalParticipants = globalStats
    ? Number(globalStats.data.totalParticipants || leaderboardPlayers.length)
    : leaderboardPlayers.length;

  await patchDocument(
    idToken,
    `projects/${projectId}/databases/(default)/documents/leaderboards/overall`,
    {
      rankings: top40,
      totalParticipants,
      updatedAt: now,
    }
  );

  console.log(`Updated users: ${updates.length}`);
  console.log(`Updated leaderboards/overall rankings: ${top40.length}`);
  return { updatedUsers: updates.length, top40Count: top40.length };
}

async function main() {
  try {
    return await runViaAdmin();
  } catch (adminErr) {
    console.warn(`firebase-admin path failed, falling back to REST: ${adminErr.message}`);
    return await runViaRest();
  }
}

main().catch((err) => {
  console.error('Math level recalculation failed:', err);
  process.exit(1);
});
