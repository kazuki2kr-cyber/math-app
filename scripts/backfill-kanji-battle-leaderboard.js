const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const dotenv = require('dotenv');
const { clientId, clientSecret } = require('firebase-tools/lib/api');

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'math-app-26c77';
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const adminEmail = process.env.TEST_USER_EMAIL;
const adminPassword = process.env.TEST_USER_PASSWORD;
const isApply = process.argv.includes('--apply');
const limitArg = readArg('--limit');
const leaderboardLimit = Math.max(1, Math.min(100, Number(limitArg || 40) || 40));

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return '';
  return process.argv[index + 1] || '';
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
  const data = {};
  Object.entries(doc.fields || {}).forEach(([key, value]) => {
    data[key] = parseFirestoreValue(value);
  });
  const parts = doc.name.split('/');
  return { id: parts[parts.length - 1], path: doc.name, data };
}

async function signInWithPassword() {
  if (!apiKey || !adminEmail || !adminPassword) {
    return getFirebaseCliAccessToken();
  }

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
    if (text.includes('PASSWORD_LOGIN_DISABLED')) {
      return getFirebaseCliAccessToken();
    }
    throw new Error(`Firebase Auth login failed: ${text}`);
  }

  return (await response.json()).idToken;
}

async function getFirebaseCliAccessToken() {
  const candidates = [
    process.platform === 'win32'
      ? ['cmd.exe', ['/c', path.join(process.cwd(), 'node_modules', '.bin', 'firebase.cmd')]]
      : [path.join(process.cwd(), 'node_modules', '.bin', 'firebase'), []],
    process.platform === 'win32' ? 'firebase.cmd' : 'firebase',
    'firebase',
  ];
  let raw = '';
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const command = Array.isArray(candidate) ? candidate[0] : candidate;
      const prefixArgs = Array.isArray(candidate) ? candidate[1] : [];
      raw = execFileSync(command, [...prefixArgs, 'login:list', '--json'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!raw) {
    throw lastError || new Error('Firebase CLI command was not available.');
  }
  const parsed = JSON.parse(raw);
  const account = parsed.result && parsed.result[0];
  const refreshToken = account && account.tokens && account.tokens.refresh_token;
  if (!refreshToken) {
    throw new Error('Firebase CLI refresh token was not available. Run firebase login first.');
  }

  const response = await fetch('https://www.googleapis.com/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Firebase CLI token refresh failed: ${await response.text()}`);
  }

  const tokenData = await response.json();
  if (!tokenData.access_token) {
    throw new Error('Firebase CLI access token refresh returned no access_token.');
  }
  return tokenData.access_token;
}

async function listDocuments(token, collectionId) {
  const documents = [];
  let pageToken = null;

  while (true) {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}`
    );
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Firestore listDocuments(${collectionId}) failed: ${await response.text()}`);
    }

    const data = await response.json();
    (data.documents || []).forEach((doc) => documents.push(parseDocument(doc)));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return documents;
}

async function patchDocument(token, documentPath, data) {
  const updateMask = Object.keys(data).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
  const response = await fetch(`https://firestore.googleapis.com/v1/${documentPath}?${updateMask}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, encodeFirestoreValue(value)])
      ),
    }),
  });

  if (!response.ok) {
    throw new Error(`PATCH ${documentPath} failed: ${await response.text()}`);
  }
}

function buildBattleRanking(userDoc) {
  const data = userDoc.data || {};
  const stats = data.kanjiBattleStats || {};
  const xp = Math.max(0, Number(stats.xp || data.kanjiBattleXp || 0));
  const wins = Math.max(0, Number(stats.wins || stats.totalWins || data.kanjiBattleWins || 0));
  const totalBattles = Math.max(0, Number(stats.totalBattles || 0));
  if (xp <= 0 && wins <= 0 && totalBattles <= 0) return null;

  return {
    uid: userDoc.id,
    name: data.displayName || data.name || data.email || 'Player',
    xp,
    wins,
    totalBattles,
    icon: data.icon || data.kanjiIcon || '',
    lastBattleAt: stats.lastBattleAt || data.kanjiBattleUpdatedAt || '',
  };
}

async function main() {
  console.log(`--- kanjiBattle leaderboard backfill (${isApply ? 'APPLY' : 'DRY-RUN'}) ---`);
  const token = await signInWithPassword();
  const userDocs = await listDocuments(token, 'users');

  const allPlayers = userDocs
    .map(buildBattleRanking)
    .filter(Boolean)
    .sort((a, b) => {
      if (b.xp !== a.xp) return b.xp - a.xp;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
    });

  const rankings = allPlayers.slice(0, leaderboardLimit);
  console.log(`ranking candidates: ${allPlayers.length}`);
  console.log(`leaderboards/kanjiBattle entries: ${rankings.length}`);
  rankings.slice(0, 10).forEach((entry, index) => {
    console.log(`${index + 1}. ${entry.name} (${entry.uid}) xp=${entry.xp} wins=${entry.wins} battles=${entry.totalBattles}`);
  });

  if (!isApply) {
    console.log('Dry-run only. Re-run with --apply to update leaderboards/kanjiBattle.');
    return;
  }

  await patchDocument(
    token,
    `projects/${projectId}/databases/(default)/documents/leaderboards/kanjiBattle`,
    {
      rankings,
      totalParticipants: allPlayers.length,
      updatedAt: new Date().toISOString(),
      source: 'scripts/backfill-kanji-battle-leaderboard.js',
    }
  );

  console.log(`Updated leaderboards/kanjiBattle with ${rankings.length} entries.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
