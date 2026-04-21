const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

// 使用前にプロジェクトIDが正しいか確認
const projectId = 'math-app-26c77';
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
  console.log('--- クリーンアップ開始 ---');
  
  for (const uid of usersToFix) {
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    
    if (!snap.exists) {
      console.log(`User ${uid} not found. Skipping.`);
      continue;
    }
    
    const data = snap.data();
    const updates = {};
    const fieldsToDelete = [];
    
    // トップレベルの unitStats.x.y や lastAttemptTimes.x.y を探す
    for (const key of Object.keys(data)) {
      if (key.startsWith('unitStats.') || key.startsWith('lastAttemptTimes.')) {
        // フィールド名にドットが含まれているトップレベルフィールド
        fieldsToDelete.push(key);
        updates[key] = FieldValue.delete();
      }
    }
    
    if (fieldsToDelete.length > 0) {
      console.log(`User: ${data.displayName || uid} (${uid})`);
      console.log(`  Deleting fields: ${fieldsToDelete.join(', ')}`);
      
      // unitStats マップ内のデータを保護しつつ、トータルスコアを再計算
      const unitStats = data.unitStats || {};
      let totalScore = 0;
      for (const stats of Object.values(unitStats)) {
        if (stats && typeof stats === 'object' && stats.maxScore) {
          totalScore += stats.maxScore;
        }
      }
      
      if (data.totalScore !== totalScore) {
        console.log(`  Correcting totalScore: ${data.totalScore} -> ${totalScore}`);
        updates.totalScore = totalScore;
      }
      
      updates.updatedAt = new Date().toISOString();
      
      await userRef.update(updates);
      console.log('  Done.');
    } else {
      console.log(`User: ${data.displayName || uid} (${uid}) - No contaminated fields found.`);
    }
  }
  
  console.log('--- クリーンアップ完了 ---');
}

cleanup().catch(console.error);
