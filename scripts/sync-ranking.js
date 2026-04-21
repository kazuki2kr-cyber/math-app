const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

// プロジェクトIDの設定
const projectId = 'math-app-26c77';
// ローカル環境で実行する場合、ADC (Application Default Credentials) が必要です。
// firebase login 済みであれば、プロジェクトID指定のみで動作する場合があります。
if (admin.apps.length === 0) {
    admin.initializeApp({ projectId });
}
const db = admin.firestore();

async function fullSyncAndCleanup() {
    console.log('--- ランキング正常化 ＆ クリーンアップ開始 ---');

    const usersSnap = await db.collection('users').get();
    const allRankings = [];
    let participantsWithScore = 0;

    console.log(`対象ユーザー数: ${usersSnap.size}`);

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const data = userDoc.data();
        const updates = {};
        let needsUpdate = false;

        // 1. 不正なトップレベルフィールド（ドット付きキー）の削除
        for (const key of Object.keys(data)) {
            if (key.includes('.')) {
                updates[key] = FieldValue.delete();
                needsUpdate = true;
                console.log(`  [${uid}] 不正フィールド削除: ${key}`);
            }
        }

        // 2. totalScore の再計算
        const unitStats = data.unitStats || {};
        let calculatedTotalScore = 0;
        for (const stats of Object.values(unitStats)) {
            if (stats && typeof stats === 'object' && stats.maxScore) {
                calculatedTotalScore += stats.maxScore;
            }
        }

        if (data.totalScore !== calculatedTotalScore) {
            updates.totalScore = calculatedTotalScore;
            needsUpdate = true;
            console.log(`  [${uid}] スコア修正: ${data.totalScore} -> ${calculatedTotalScore}`);
        }

        // 3. 更新実行
        if (needsUpdate) {
            updates.updatedAt = new Date().toISOString();
            await userDoc.ref.update(updates);
            console.log(`  [${uid}] ドキュメント更新完了`);
        }

        // 4. ランキング用データの準備
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

    // 5. リーダーボード（上位40名）の再生成
    allRankings.sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return (b.xp || 0) - (a.xp || 0);
    });

    const top40 = allRankings.slice(0, 40);

    await db.doc('leaderboards/overall').set({
        rankings: top40,
        totalParticipants: participantsWithScore,
        updatedAt: new Date().toISOString()
    });
    console.log(`leaderboards/overall を更新しました（${top40.length}名）`);

    // 6. グローバル統計の更新
    await db.doc('stats/global').set({
        totalParticipants: participantsWithScore,
        updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log(`stats/global の参加者数を ${participantsWithScore} 名に更新しました`);

    console.log('--- すべての処理が完了しました ---');
}

fullSyncAndCleanup().catch(err => {
    console.error('処理失敗:', err);
    process.exit(1);
});
