import * as admin from 'firebase-admin';

// すでに初期化されているかチェック
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

async function syncLeaderboard() {
    console.log('--- Starting Leaderboard Sync and Cleanup ---');

    const usersSnap = await db.collection('users').get();
    const allRankings: any[] = [];
    let participantsWithScore = 0;

    console.log(`Found ${usersSnap.size} users to check.`);

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const data = userDoc.data();
        const rawFields = data; // ドキュメントの全フィールド

        let needsUpdate = false;
        const fieldsToDelete: any = {};
        const updates: any = {};

        // 1. ゴーストフィールド（ドキュメント直下のドット付きキー）の特定
        Object.keys(rawFields).forEach(key => {
            if (key.includes('.')) {
                // ドットを含むキーはトップレベルに存在するべきではない（ネストされたマップとして扱うべき）
                fieldsToDelete[key] = admin.firestore.FieldValue.delete();
                needsUpdate = true;
                console.log(`  [USER:${uid}] Found ghost field: ${key}`);
            }
        });

        // 2. 正しい合計スコアの計算
        const unitStats = data.unitStats || {};
        let calculatedTotalScore = 0;
        Object.keys(unitStats).forEach(unitId => {
            const stats = unitStats[unitId];
            if (stats && typeof stats.maxScore === 'number') {
                calculatedTotalScore += stats.maxScore;
            }
        });

        if (data.totalScore !== calculatedTotalScore) {
            updates.totalScore = calculatedTotalScore;
            needsUpdate = true;
            console.log(`  [USER:${uid}] totalScore mismatch: ${data.totalScore} -> ${calculatedTotalScore}`);
        }

        // 3. 更新の実行
        if (needsUpdate) {
            await userDoc.ref.update({ ...updates, ...fieldsToDelete });
            console.log(`  [USER:${uid}] Updated doc.`);
        }

        // 4. ランキング用データの収集（クリーンアップ後の値を使用）
        if (calculatedTotalScore > 0) {
            participantsWithScore++;
        }

        allRankings.push({
            uid: uid,
            name: data.displayName || data.email || '名無し',
            totalScore: calculatedTotalScore,
            xp: data.xp || 0,
            icon: data.icon || '📐',
            level: data.level || 1
        });
    }

    // 5. ランキングの生成（上位40名）
    allRankings.sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return b.xp - a.xp;
    });

    const top40 = allRankings.slice(0, 40);

    // 6. リーダーボードドキュメントの更新
    await db.doc('leaderboards/overall').set({
        rankings: top40,
        totalParticipants: participantsWithScore,
        updatedAt: new Date().toISOString()
    });
    console.log(`Updated leaderboards/overall with ${top40.length} users.`);

    // 7. 全体統計の更新
    await db.doc('stats/global').set({
        totalParticipants: participantsWithScore,
        updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log(`Updated stats/global totalParticipants to ${participantsWithScore}.`);

    console.log('--- Leaderboard Sync and Cleanup Completed ---');
}

syncLeaderboard().catch(err => {
    console.error('Sync failed:', err);
    process.exit(1);
});
