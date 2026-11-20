const admin = require('firebase-admin');
const { FieldPath, FieldValue } = require('firebase-admin/firestore');
const { buildLiteralDottedFieldDeleteUpdateArgs } = require('./lib/unitStatsRepair');

// 使用前にプロジェクトIDが正しいか確認
const projectId = 'math-app-26c77';
const isDryRun = !process.argv.includes('--apply');
admin.initializeApp({ projectId });
const db = admin.firestore();

const usersToFix = [
  '3geTJLlNuOb1ESqL18GILDfGXJI2',
  '3npB0Xn95kcRk4gMzn5vMH1EA8q1',
  '5nSNAtHGA0dVIB47VTAzrXambK63',
  'AheanXh11zcoYnHipbjwjpZvCSd2',
  'FWpQnxeKLdhua3FFs3cJJmaJ01R2',
  'FdJCyRcCNFeurNtxlMUbUquCXkr1',
  'Fq1S9snOdfeXsBsibxhGpEuC3gJ3',
  'YwZztLptrLZ09KOFbMnGiFPqBfz1',
  'do9kex5Yq3arNQxrT4h76rJowXi2',
  'hndRxW5Ujdcf069IlavQdFnnuNC3',
  'mG0Cgkm7sXOigsyfNDkn81M7kR83'
];

async function cleanup() {
  console.log(`--- クリーンアップ開始 (${isDryRun ? 'DRY-RUN: --apply 未指定のため書き込みなし' : 'APPLY'}) ---`);
  
  for (const uid of usersToFix) {
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    
    if (!snap.exists) {
      console.log(`User ${uid} not found. Skipping.`);
      continue;
    }
    
    const data = snap.data();
    // unitStats マップ内のデータを保護しつつ、トータルスコアを再計算
    const unitStats = data.unitStats || {};
    let totalScore = 0;
    for (const stats of Object.values(unitStats)) {
      if (stats && typeof stats === 'object' && stats.maxScore) {
        totalScore += stats.maxScore;
      }
    }

    const extraFields = {
      updatedAt: new Date().toISOString(),
      ...(data.totalScore !== totalScore ? { totalScore } : {}),
    };

    const { fieldsToDelete, updateArgs } = buildLiteralDottedFieldDeleteUpdateArgs(
      data,
      FieldPath,
      FieldValue,
      extraFields,
      (key) => key.startsWith('unitStats.') || key.startsWith('lastAttemptTimes.')
    );
    
    if (fieldsToDelete.length > 0) {
      console.log(`User: ${data.displayName || uid} (${uid})`);
      console.log(`  Deleting literal top-level fields: ${fieldsToDelete.join(', ')}`);
      if (data.totalScore !== totalScore) {
        console.log(`  Correcting totalScore: ${data.totalScore} -> ${totalScore}`);
      }
      if (!isDryRun) {
        await userRef.update(...updateArgs);
      }
      console.log('  Done.');
    } else {
      console.log(`User: ${data.displayName || uid} (${uid}) - No contaminated fields found.`);
    }
  }
  
  console.log('--- クリーンアップ完了 ---');
}

cleanup().catch(console.error);
