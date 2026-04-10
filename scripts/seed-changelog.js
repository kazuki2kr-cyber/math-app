const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, Timestamp } = require('firebase/firestore');
require('dotenv').config({ path: '.env.local' });

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function seed() {
  console.log('Seeding changelog data...');
  const changelogRef = collection(db, 'changelog');

  const logs = [
    {
      version: '1.0.0',
      date: Timestamp.fromDate(new Date('2025-01-01')),
      summary: 'サービス正式リリース (v1.0.0)',
      type: 'major',
      details: [
        '数式ドリルの基本演習機能のリリース',
        'Googleアカウントによるログイン・プロフィール管理',
        'XP獲得およびレベルアップシステムの導入',
        'レスポンシブデザイン対応'
      ]
    },
    {
      version: '1.0.1',
      date: Timestamp.fromDate(new Date('2026-04-01')),
      summary: '管理者向け分析機能の追加 (v1.0.1)',
      type: 'minor',
      details: [
        '管理者ダッシュボードのプロトタイプ実装',
        '単元ごとの正答率・平均解答時間の可視化',
        'ユーザー管理機能（管理者ロール付与）の追加'
      ]
    },
    {
      version: '1.0.2',
      date: Timestamp.now(),
      summary: 'UX向上とセキュリティの強化 (v1.0.2)',
      type: 'patch',
      details: [
        '相関分析画面での数式（LaTeX）表示の品質向上',
        'セキュリティルールの最適化による安全なデータアクセスの確保',
        '更新履歴（本画面）の追加',
        '各種パフォーマンスの改善'
      ]
    }
  ];

  for (const log of logs) {
    try {
      const docRef = await addDoc(changelogRef, log);
      console.log(`Added log with ID: ${docRef.id} (v${log.version})`);
    } catch (e) {
      console.error('Error adding document: ', e);
    }
  }
  console.log('Done!');
  process.exit(0);
}

seed();
