const admin = require('firebase-admin');

// プロジェクトIDの設定
const projectId = 'math-app-26c77';

// エミュレータを使用している場合の環境設定
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
  console.log('--- エミュレータ環境で実行します ---');
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}

admin.initializeApp({
  projectId: projectId
});

const db = admin.firestore();

async function migrate() {
  console.log('--- データ構造のマイグレーション（サブコレクション化）を開始します ---');
  
  const unitsSnap = await db.collection('units').get();
  
  if (unitsSnap.empty) {
    console.log('ユニットが見つかりませんでした。');
    return;
  }

  console.log(`${unitsSnap.size} 件のユニットを処理します...`);

  let totalDocWrites = 0;
  let unitCount = 0;

  for (const uDoc of unitsSnap.docs) {
    const unitData = uDoc.data();
    const questions = unitData.questions;

    if (questions && Array.isArray(questions) && questions.length > 0) {
      console.log(`ユニット: ${uDoc.id} (${unitData.title || '無題'}) - ${questions.length} 問を移行中...`);
      
      const batch = db.batch();
      const questionsColl = uDoc.ref.collection('questions');

      questions.forEach((q, i) => {
        const qId = q.id || `q_${i}`;
        const qRef = questionsColl.doc(qId);
        batch.set(qRef, {
          ...q,
          order: q.order ?? i,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        totalDocWrites++;
      });

      // 元のドキュメントから配列を削除（または退避）
      batch.update(uDoc.ref, {
        questions: admin.firestore.FieldValue.delete(),
        _legacy_questions: questions, // 安全のためにバックアップとして残す
        totalQuestions: questions.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      totalDocWrites++;

      await batch.commit();
      unitCount++;
    } else {
      console.log(`ユニット: ${uDoc.id} - 移行対象の問題がありません。`);
    }
  }

  console.log('\n--- マイグレーション完了 ---');
  console.log(`処理したユニット数: ${unitCount}`);
  console.log(`総書き込みドキュメント数: ${totalDocWrites}`);
  console.log('--------------------------');
}

migrate()
  .then(() => {
    console.log('完了しました。');
    process.exit(0);
  })
  .catch(err => {
    console.error('マイグレーション中にエラーが発生しました:', err);
    process.exit(1);
  });
