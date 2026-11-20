let admin;
try {
  admin = require('firebase-admin');
} catch (err) {
  console.error('\x1b[31m%s\x1b[0m', 'Error: firebase-admin が見つかりません。');
  console.error('以下のコマンドで実行してください:');
  console.error('  $env:NODE_PATH=".\\functions\\node_modules"; node scripts/fix-user-unitstats.js');
  process.exit(1);
}

/**
 * unitStats ドット記法バグ 根本修正マイグレーションスクリプト
 *
 * 問題:
 *   unitId に '.' が含まれる場合 (例: '1.正負の数の加減'), Firestore の set()+merge:true で
 *   ドット記法キーを使うとパス区切りと解釈され unitStats['1']['正負の数の加減'] (3階層) に
 *   書き込まれていた。読み取り時は unitStats['1.正負の数の加減'] (リテラルキー) を参照するため
 *   毎回 existingUnitData={} → isHighScore=true → totalScore が全得点分累積していた。
 *
 * 修正内容:
 *   1. 各ユーザーの unitStats を正規化（リテラルキー形式に統一）
 *      - 旧リテラルキー形式 unitStats['1.正負の数の加減'] と
 *        新3階層ネスト形式 unitStats['1']['正負の数の加減'] の両方を収集
 *      - drillCount が大きい方（=より最新）を優先してマージ
 *   2. totalScore を正しい値（全単元の maxScore 合計）に再計算
 *   3. leaderboards/overall のランキング配列も更新
 *
 * 実行方法:
 *   $env:NODE_PATH=".\\functions\\node_modules"; node scripts/fix-user-unitstats.js [--dry-run]
 *
 * オプション:
 *   --dry-run : Firestoreへの書き込みを行わず、変更内容だけを表示する
 */

admin.initializeApp({ projectId: 'math-app-26c77' });
const db = admin.firestore();

const isDryRun = !process.argv.includes('--apply');
const {
  extractNestedAsLiteralKeys,
  mergeUnitData,
  sanitizeRankingName,
} = require('./lib/unitStatsRepair');

async function fixUserUnitStats() {
  console.log(`\n====== unitStats マイグレーション ======`);
  console.log(`モード: ${isDryRun ? '🔍 DRY-RUN（書き込みなし）' : '✍️  REAL（Firestoreに書き込む）'}`);
  console.log(`========================================\n`);

  const usersSnap = await db.collection('users').get();
  console.log(`対象ユーザー数: ${usersSnap.size} 名\n`);

  let fixedCount = 0;
  let skippedCount = 0;

  const leaderboardUpdates = []; // { uid, totalScore, xp, level, name, ... }

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const data = userDoc.data();
    const displayName = data.displayName || uid;
    const rawUnitStats = data.unitStats || {};

    // --- unitStats を正規化 ---
    // リテラルキー形式と3階層ネスト形式の両方を収集してマージ
    const literalKeyed = extractNestedAsLiteralKeys(rawUnitStats);

    // 各ユニットの重複（古い/新しい）をマージ
    const cleanUnitStats = {};
    for (const [key, val] of Object.entries(literalKeyed)) {
      if (cleanUnitStats[key]) {
        cleanUnitStats[key] = mergeUnitData(cleanUnitStats[key], val);
      } else {
        cleanUnitStats[key] = val;
      }
    }

    // --- totalScore を再計算 ---
    let correctTotalScore = 0;
    for (const val of Object.values(cleanUnitStats)) {
      if (val && typeof val === 'object' && val.maxScore != null) {
        correctTotalScore += val.maxScore;
      }
    }

    const currentTotalScore = data.totalScore || 0;
    const needsFix = currentTotalScore !== correctTotalScore
      || JSON.stringify(rawUnitStats) !== JSON.stringify(cleanUnitStats);

    if (!needsFix) {
      console.log(`  ✅ ${displayName}: 変更不要 (totalScore=${currentTotalScore})`);
      skippedCount++;
      continue;
    }

    console.log(`  🔧 ${displayName} (${uid})`);
    console.log(`     totalScore: ${currentTotalScore} → ${correctTotalScore}`);
    console.log(`     unitStats keys: ${Object.keys(rawUnitStats).join(', ')}`);
    console.log(`     cleanUnitStats keys: ${Object.keys(cleanUnitStats).join(', ')}`);

    if (!isDryRun) {
      await db.collection('users').doc(uid).update({
        unitStats: cleanUnitStats,
        totalScore: correctTotalScore,
        updatedAt: new Date().toISOString(),
      });
    }

    // ランキング更新用データを収集
    leaderboardUpdates.push({
      uid,
      name: sanitizeRankingName(data.displayName),
      totalScore: correctTotalScore,
      xp: data.xp || 0,
      level: data.level || 1,
      icon: data.icon || '📐',
      title: data.title || '算数卒業生',
    });

    fixedCount++;
  }

  console.log(`\n--- unitStats 修正完了 ---`);
  console.log(`修正: ${fixedCount} 名 / スキップ: ${skippedCount} 名`);

  // --- leaderboards/overall を再構築 ---
  if (leaderboardUpdates.length > 0) {
    console.log(`\nleaderboards/overall を更新中...`);
    try {
      const lbSnap = await db.collection('leaderboards').doc('overall').get();
      if (lbSnap.exists) {
        let rankings = lbSnap.data().rankings || [];

        // 修正したユーザーのエントリーを更新
        for (const update of leaderboardUpdates) {
          const idx = rankings.findIndex(r => r.uid === update.uid);
          if (idx >= 0) {
            rankings[idx] = { ...rankings[idx], ...update };
            console.log(`  ✅ ランキング更新: ${update.name} → totalScore=${update.totalScore}`);
          }
        }

        // totalScore でソートし直す
        rankings.sort((a, b) => {
          if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
          return (b.xp || 0) - (a.xp || 0);
        });

        if (!isDryRun) {
          await db.collection('leaderboards').doc('overall').update({ rankings });
          console.log(`  leaderboards/overall を更新しました。`);
        } else {
          console.log(`  [DRY-RUN] leaderboards/overall の更新をスキップ`);
        }
      } else {
        console.log(`  leaderboards/overall が存在しないためスキップ`);
      }
    } catch (err) {
      console.error(`  ⚠️  ランキング更新中にエラー: ${err.message}`);
    }
  }

  console.log(`\n====== 完了 ======`);
  if (isDryRun) {
    console.log(`※ DRY-RUN のため実際のデータは変更されていません。`);
    console.log(`  実際に実行するには --dry-run を外して再実行してください。`);
  }
}

fixUserUnitStats()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('致命的なエラー:', err);
    process.exit(1);
  });
