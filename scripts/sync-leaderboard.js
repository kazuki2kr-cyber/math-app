const admin = require('firebase-admin');

// プロジェクトIDの設定
const projectId = 'math-app-26c77';
if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}
const db = admin.firestore();

async function syncLeaderboard() {
  console.log('--- 算数リーダーボード同期開始 ---');

  try {
    const allPlayers = [];
    let lastDoc = null;
    let totalFetched = 0;
    const PAGE_SIZE = 500;

    console.log('ユーザーデータを取得中...');

    // 1. ページングによる全ユーザーデータの取得
    while (true) {
      let querySnapshot;
      if (lastDoc) {
        querySnapshot = await db.collection('users').startAfter(lastDoc).limit(PAGE_SIZE).get();
      } else {
        querySnapshot = await db.collection('users').limit(PAGE_SIZE).get();
      }

      if (querySnapshot.empty) break;

      querySnapshot.forEach(doc => {
        const data = doc.data();
        if ((data.totalScore && data.totalScore > 0) || (data.xp && data.xp > 0)) {
          allPlayers.push({
            uid: doc.id,
            name: data.displayName || '不明',
            totalScore: data.totalScore || 0,
            xp: data.xp || 0,
            icon: data.icon || '📐',
            level: data.level || 1,
            title: data.title || '算数卒業生'
          });
        }
      });

      totalFetched += querySnapshot.size;
      console.log(`取得済み: ${totalFetched} 名...`);
      lastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
      
      if (querySnapshot.size < PAGE_SIZE) break;
    }

    console.log(`抽出完了: ${allPlayers.length} 名 (ランキング対象者)`);

    // 2. ソート (totalScore 降順 -> xp 降順)
    allPlayers.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return b.xp - a.xp;
    });

    // 3. 上位40名の選出
    const rankings = allPlayers.slice(0, 40);
    console.log(`上位40名を特定しました。1位スコア: ${rankings[0]?.totalScore || 0} pts`);

    // 4. 参加者数の取得 (stats/global から)
    const globalStatsSnap = await db.doc('stats/global').get();
    let totalParticipants = allPlayers.length;
    if (globalStatsSnap.exists) {
      const statsData = globalStatsSnap.data();
      totalParticipants = statsData.totalParticipants || allPlayers.length;
    }

    // 5. リーダーボードの上書き
    await db.doc('leaderboards/overall').set({
      rankings,
      totalParticipants,
      updatedAt: new Date().toISOString()
    });

    console.log('--- リーダーボードの同期が正常に完了しました ---');
    console.log(`参加者総数: ${totalParticipants}`);
    
    // 検証用: 特定ユーザーのデータを確認
    const targetUser = allPlayers.find(p => p.uid === '5nSNAtHGA0dVIB47VTAzrXambK63');
    if (targetUser) {
      console.log(`検証: 南茂蘭蘭さんのスコア = ${targetUser.totalScore}`);
    }

  } catch (error) {
    console.error('致命的なエラーが発生しました:', error);
    process.exit(1);
  }
}

syncLeaderboard().then(() => process.exit(0));
