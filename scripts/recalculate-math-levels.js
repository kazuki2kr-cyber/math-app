const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const admin = require('firebase-admin');

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'math-app-26c77';
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

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }

  const db = admin.firestore();
  const now = new Date().toISOString();
  const usersSnap = await db.collection('users').get();
  const updates = [];
  const leaderboardPlayers = [];

  usersSnap.forEach((doc) => {
    const data = doc.data();
    const xp = Math.max(0, Number(data.xp || 0));
    const levelData = calculateLevelAndProgress(xp);
    const title = getTitleForLevel(levelData.level);

    if ((Number(data.totalScore || 0) > 0) || xp > 0) {
      leaderboardPlayers.push({
        uid: doc.id,
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
      uid: doc.id,
      displayName: data.displayName || data.email || '',
      xp,
      oldLevel: Number(data.level || 1),
      newLevel: levelData.level,
      oldNextLevelXp: Number(data.nextLevelXp || 0),
      newNextLevelXp: levelData.nextLevelXp,
      ref: doc.ref,
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

  console.log(`Math level recalculation (${isApply ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`Checked users: ${usersSnap.size}`);
  console.log(`Pending user updates: ${updates.length}`);
  console.log(JSON.stringify(updates.map(({ ref, data, ...item }) => item), null, 2));

  if (!isApply) {
    console.log('No writes performed. Re-run with --apply to update Firestore.');
    return;
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
}

main().catch((err) => {
  console.error('Math level recalculation failed:', err);
  process.exit(1);
});
