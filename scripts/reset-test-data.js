const admin = require('firebase-admin');

/**
 * テストデータ・リセットスクリプト
 * 
 * 学習履歴、スコア、統計、ランキングデータを一括削除・リセットします。
 * ユーザーアカウント（isAdmin含む）は保持されます。
 */

admin.initializeApp({
  projectId: 'math-app-26c77'
});

const db = admin.firestore();

async function deleteCollection(collectionPath, batchSize = 100) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(query, resolve) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  process.nextTick(() => {
    deleteQueryBatch(query, resolve);
  });
}

async function reset() {
  console.log('--- テストデータのリセットを開始します ---');

  // 1. scores コレクションの削除
  console.log('Cleaning collection: scores...');
  await deleteCollection('scores');

  // 2. leaderboards/overall のリセット
  console.log('Resetting leaderboard: overall...');
  await db.doc('leaderboards/overall').set({
    rankings: [],
    totalParticipants: 0,
    updatedAt: new Date().toISOString()
  });

  // 3. stats コレクションの削除（再帰的）
  console.log('Cleaning collection: stats...');
  await deleteCollection('stats');

  // 4. users 進行状況のリセット & サブコレクションの削除
  console.log('Resetting user progress and history...');
  const usersSnap = await db.collection('users').get();
  
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const email = userDoc.data().email || 'unknown';
    console.log(`  Processing user: ${email} (${uid})`);

    // フィールドのリセット
    await userDoc.ref.update({
      totalScore: 0,
      xp: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // サブコレクション attempts の削除
    const attemptsSnap = await userDoc.ref.collection('attempts').get();
    if (!attemptsSnap.empty) {
      const batch = db.batch();
      attemptsSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      console.log(`    Deleted ${attemptsSnap.size} attempts`);
    }

    // サブコレクション wrong_answers の削除
    const wrongSnap = await userDoc.ref.collection('wrong_answers').get();
    if (!wrongSnap.empty) {
      const batch = db.batch();
      wrongSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      console.log(`    Deleted ${wrongSnap.size} wrong_answer records`);
    }
  }

  // 5. 各ユニットの stats サブコレクションがあれば削除
  console.log('Cleaning unit stats...');
  const unitsSnap = await db.collection('units').get();
  for (const unitDoc of unitsSnap.docs) {
    const statsSnap = await unitDoc.ref.collection('stats').get();
    if (!statsSnap.empty) {
      const batch = db.batch();
      statsSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      console.log(`    Cleaned stats for unit: ${unitDoc.id}`);
    }
  }

  console.log('\n--- リセットが完了しました ---');
}

reset()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error during reset:', err);
    process.exit(1);
  });
