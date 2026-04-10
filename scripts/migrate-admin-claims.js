let admin;
try {
  admin = require('firebase-admin');
} catch (err) {
  console.error('\x1b[31m%s\x1b[0m', 'Error: firebase-admin が見つかりません。');
  console.error('以下のいずれかの方法で解決してください：');
  console.error('1. ルートでインストールする: npm install -D firebase-admin');
  console.error('2. functionsのライブラリを利用して実行する:');
  console.error('   $env:NODE_PATH=".\\functions\\node_modules"; node scripts/migrate-admin-claims.js');
  process.exit(1);
}

/**
 * 管理者カスタムクレーム移行スクリプト
 * 
 * Firestoreの users/{uid}.isAdmin フィールドが true のユーザーに対し、
 * Firebase Auth のカスタムクレーム { admin: true } を一括設定します。
 * 
 * 実行方法:
 * 1. サービスアカウントキーを生成し、環境変数に設定:
 *    export GOOGLE_APPLICATION_CREDENTIALS="path/to/service-account.json"
 * 2. 実行:
 *    node scripts/migrate-admin-claims.js
 */

// プロジェクトIDを明示的に指定して初期化
// 環境変数 GOOGLE_APPLICATION_CREDENTIALS が設定されている必要があります。
admin.initializeApp({
  projectId: 'math-app-26c77'
});

const db = admin.firestore();
const auth = admin.auth();

async function migrate() {
  console.log('--- 管理者カスタムクレーム移行を開始します ---');
  
  // isAdmin: true のユーザーを検索
  const usersSnap = await db.collection('users').where('isAdmin', '==', true).get();
  
  if (usersSnap.empty) {
    console.log('isAdmin: true のユーザーは見つかりませんでした。');
    return;
  }

  console.log(`${usersSnap.size} 名の管理者が見つかりました。カスタムクレームを設定します...`);

  let successCount = 0;
  let failCount = 0;

  for (const doc of usersSnap.docs) {
    const uid = doc.id;
    const data = doc.data();
    const email = data.email || 'メールアドレス不明';

    try {
      // カスタムクレームを設定
      await auth.setCustomUserClaims(uid, { admin: true });
      console.log(`✅ [成功] ${email} (UID: ${uid})`);
      successCount++;
    } catch (err) {
      console.error(`❌ [失敗] ${email} (UID: ${uid}): ${err.message}`);
      failCount++;
    }
  }

  console.log('\n--- 移行結果 ---');
  console.log(`成功: ${successCount} 名`);
  console.log(`失敗: ${failCount} 名`);
  console.log('----------------');
  
  if (successCount > 0) {
    console.log('※ 反映には、対象ユーザーが次回トークンを更新（再サインイン等）する必要があります。');
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('致命的なエラーが発生しました:', err);
    process.exit(1);
  });
