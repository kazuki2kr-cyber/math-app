const admin = require('firebase-admin');
const path = require('path');

// 環境変数の読み込み（必要に応じて）
// require('dotenv').config();

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'math-app-76785' // FirebaseコンソールのプロジェクトIDに合わせてください
  });
}

const db = admin.firestore();

async function seed() {
  const unitId = 'sample-kanji-unit-1';
  const unitData = {
    title: "一年生のかん字（一）",
    category: "漢検10級相当",
    subject: "kanji",
    questions: [
      {
        id: "k1-1",
        question_text: "高い<u>やま</u>に登る。",
        answer: "山",
        options: ["山"],
        explanation: "「やま」と読みます。三本の縦線で山の形を表しています。"
      },
      {
        id: "k1-2",
        question_text: "<u>かわ</u>で魚をつる。",
        answer: "川",
        options: ["川"],
        explanation: "「かわ」と読みます。水の流れる様子を表しています。"
      },
      {
        id: "k1-3",
        question_text: "<u>てん</u>きが良い。",
        answer: "天",
        options: ["天"],
        explanation: "「てん」と読みます。人の頭の上の広い空間を表しています。"
      }
    ]
  };

  await db.collection('units').doc(unitId).set(unitData);
  console.log(`Sample unit ${unitId} added successfully.`);
}

seed().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
