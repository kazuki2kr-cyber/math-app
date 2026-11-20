const admin = require('firebase-admin');
const { FieldPath, FieldValue } = require('firebase-admin/firestore');
const { buildLiteralDottedFieldDeleteUpdateArgs, sanitizeRankingName } = require('./lib/unitStatsRepair');

// プロジェクトIDの設定
const projectId = 'math-app-26c77';
const isDryRun = !process.argv.includes('--apply');
// ローカル環境で実行する場合、ADC (Application Default Credentials) が必要です。
// firebase login 済みであれば、プロジェクトID指定のみで動作する場合があります。
if (admin.apps.length === 0) {
    admin.initializeApp({ projectId });
}
const db = admin.firestore();

async function fullSyncAndCleanup() {
    console.log(`--- ランキング正常化 ＆ クリーンアップ開始 (${isDryRun ? 'DRY-RUN: --apply 未指定のため書き込みなし' : 'APPLY'}) ---`);

    const usersSnap = await db.collection('users').get();
    const allRankings = [];
    let participantsWithScore = 0;

    console.log(`対象ユーザー数: ${usersSnap.size}`);

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const data = userDoc.data();

        // 1. totalScore の再計算
        const unitStats = data.unitStats || {};
        let calculatedTotalScore = 0;
        for (const stats of Object.values(unitStats)) {
            if (stats && typeof stats === 'object' && stats.maxScore) {
                calculatedTotalScore += stats.maxScore;
            }
        }

        const scoreNeedsUpdate = data.totalScore !== calculatedTotalScore;
        if (scoreNeedsUpdate) {
            console.log(`  [${uid}] スコア修正: ${data.totalScore} -> ${calculatedTotalScore}`);
        }

        // 2. 不正なトップレベルフィールド（ドット付きキー）を FieldPath で安全に削除
        const extraFields = {
            updatedAt: new Date().toISOString(),
            ...(scoreNeedsUpdate ? { totalScore: calculatedTotalScore } : {}),
        };
        const { fieldsToDelete, updateArgs } = buildLiteralDottedFieldDeleteUpdateArgs(
            data,
            FieldPath,
            FieldValue,
            extraFields
        );
        for (const key of fieldsToDelete) {
            console.log(`  [${uid}] 不正フィールド削除: ${key}`);
        }

        // 3. 更新実行
        if (fieldsToDelete.length > 0 || scoreNeedsUpdate) {
            if (!isDryRun) {
                await userDoc.ref.update(...updateArgs);
            }
            console.log(`  [${uid}] ドキュメント更新完了`);
        }

        // 4. ランキング用データの準備
        if (data.hasParticipated === true || calculatedTotalScore > 0 || Number(data.xp || 0) > 0) {
            participantsWithScore++;
        }

        if (calculatedTotalScore > 0 || Number(data.xp || 0) > 0) {
            allRankings.push({
                uid: uid,
                name: sanitizeRankingName(data.displayName),
                totalScore: calculatedTotalScore,
                xp: data.xp || 0,
                icon: data.icon || '📐',
                level: data.level || 1
            });
        }
    }

    // 5. リーダーボード（上位40名）の再生成
    allRankings.sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return (b.xp || 0) - (a.xp || 0);
    });

    const top40 = allRankings.slice(0, 40);

    if (!isDryRun) {
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
    } else {
        console.log(`[DRY-RUN] leaderboards/overall（${top40.length}名）および stats/global（${participantsWithScore}名）の書き込みをスキップしました`);
    }

    console.log('--- すべての処理が完了しました ---');
}

fullSyncAndCleanup().catch(err => {
    console.error('処理失敗:', err);
    process.exit(1);
});
