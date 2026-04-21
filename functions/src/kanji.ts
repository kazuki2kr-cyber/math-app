import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import vision from "@google-cloud/vision";

const db = admin.firestore();
const visionClient = new vision.ImageAnnotatorClient();

// ==========================================
// 漢字のレベル計算ユーティリティ (literary themes)
// ==========================================
function calculateKanjiLevel(kanjiXp: number) {
  const MAX_LEVEL = 100;
  let level = 1;
  let accumulatedXp = 0;

  while (level < MAX_LEVEL) {
    // Lv1〜100は一律200XP、Lv101以降は今後追加可能
    const xpForNext = 200;

    if (kanjiXp >= accumulatedXp + xpForNext) {
      accumulatedXp += xpForNext;
      level++;
    } else {
      const currentLevelXp = kanjiXp - accumulatedXp;
      const progressPercent = Math.min(100, Math.max(0, (currentLevelXp / xpForNext) * 100));
      return { level, currentLevelXp, nextLevelXp: xpForNext, progressPercent };
    }
  }

  return { level: MAX_LEVEL, currentLevelXp: 0, nextLevelXp: 0, progressPercent: 100 };
}

function getKanjiTitle(level: number): string {
  if (level >= 100) return '万葉の匠';
  if (level >= 90) return '言葉の錬金術師';
  if (level >= 80) return '文豪の卵';
  if (level >= 70) return '筆の達人';
  if (level >= 60) return '書の探求者';
  if (level >= 50) return '墨客';
  if (level >= 40) return '漢字愛好家';
  if (level >= 30) return '文字の探求者';
  if (level >= 20) return '見習い書士';
  if (level >= 10) return '漢字の初学者';
  return 'ひらがなユーザー';
}

// ==========================================
// 文字認識 ＆ 判定 (Document Text Detection)
// ==========================================
export const recognizeKanjiBatch = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "認証が必要です。");
    }

    const { unitId, composedImageBase64, questionIds } = data as { unitId: string, composedImageBase64: string, questionIds?: string[] };
    if (!unitId || !composedImageBase64) {
      throw new functions.https.HttpsError("invalid-argument", "unitId と画像のBase64データが必要です。");
    }

    const uid = context.auth.uid;
    const userName = context.auth.token?.name || context.auth.token?.email || "名無し";

    // base64のプレフィックスを取り除く
    const base64Data = composedImageBase64.replace(/^data:image\/\w+;base64,/, "");

    // 1. Vision API 呼び出し
    let visionResult;
    try {
      // documentTextDetection よりも構造解析を抑えた textDetection の方が、
      // まばらな手書き文字を「見たまま」の座標で認識するのに適している。
      const [result] = await visionClient.textDetection({
        image: { content: base64Data },
        imageContext: {
          languageHints: ["ja"],
        }
      });
      visionResult = result;
    } catch (e: any) {
      console.error("Vision API Error:", e);
      throw new functions.https.HttpsError("internal", "画像認識処理中にエラーが発生しました。");
    }

    // 2. 単元情報の取得
    let questions: any[] = [];
    if (unitId === 'sample-kanji-1') {
      questions = [
        { id: 'k1-1', question_text: '明日は<u>がっこう</u>に行く。', answer: '学校', options: ['学校'] },
        { id: 'k1-2', question_text: '<u>せんせい</u>に挨拶する。', answer: '先生', options: ['先生'] },
        { id: 'k1-3', question_text: '<u>こくご</u>の辞書を引く。', answer: '国語', options: ['国語'] },
      ];
    } else {
      const unitDoc = await db.doc(`units/${unitId}`).get();
      if (!unitDoc.exists) {
        throw new functions.https.HttpsError("not-found", "単元が見つかりません。");
      }
      const unitData = unitDoc.data()!;
      let allQuestions: any[] = Array.isArray(unitData.questions) ? unitData.questions : [];
      if (allQuestions.length === 0) {
        const qSnap = await db.collection(`units/${unitId}/questions`).get();
        allQuestions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      }

      // フロントで抽出・シャッフルしたquestionIdsが渡された場合はその順序で絞り込む
      if (questionIds && Array.isArray(questionIds) && questionIds.length > 0) {
        const questionMap = new Map(allQuestions.map((q: any) => [q.id, q]));
        questions = questionIds.map(id => questionMap.get(id)).filter(Boolean);
      } else {
        questions = allQuestions;
      }
    }

    // 3. Vision APIの認識結果から文字を抽出
    const recognizedCharacters: { text: string; x: number; y: number }[] = [];
    
    // textDetection (textAnnotations) を使用
    // textAnnotations[0] は画像全体のテキスト、[1]以降が個別の単語/断画
    const annotations = visionResult.textAnnotations || [];
    if (annotations.length > 1) {
      for (let i = 1; i < annotations.length; i++) {
        const annotation = annotations[i];
        if (!annotation.description || !annotation.description.trim()) continue;

        const vertices = annotation.boundingPoly?.vertices || [];
        if (vertices.length > 0) {
          const xs = vertices.map(v => v.x || 0);
          const ys = vertices.map(v => v.y || 0);
          const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
          const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;

          // アノテーション（単語/文字）を1文字ずつに分割して保存
          // textDetectionは複数の文字をまとめることがあるため
          const text = annotation.description;
          if (text.length > 1) {
            // 文字列として認識された場合は、その中心座標を共有しつつ分割（簡易的な近似）
            for (let j = 0; j < text.length; j++) {
              recognizedCharacters.push({
                text: text[j],
                x: avgX, 
                y: avgY
              });
            }
          } else {
            recognizedCharacters.push({
              text: text,
              x: avgX,
              y: avgY
            });
          }
        }
      }
    }

    // フロントエンドの縦1列レイアウト (CELL_SIZE 300 + MARGIN 20) に基づいてソート
    const CELL_SIZE = 300;
    const MARGIN = 20;
    const ROW_HEIGHT = CELL_SIZE + MARGIN;

    const sortedChars = recognizedCharacters.sort((a, b) => {
      const rowA = Math.floor(a.y / ROW_HEIGHT);
      const rowB = Math.floor(b.y / ROW_HEIGHT);
      if (rowA !== rowB) return rowA - rowB;
      return a.x - b.x; // 横書きを考慮し、同じ行内では左から右へ
    });

    // 4. 正誤判定の実行
    // 空欄だった場合はスキップされるため、インデックスがずれる可能性がある。
    // そのため、回答者の書いた文字の座標(row, col) を厳密に計算して問題インデックスと照らし合わせる
    const correctQuestions: any[] = [];
    const wrongQuestions: any[] = [];
    let serverScore = 0;

    questions.forEach((q, index) => {
      // 縦1列レイアウトを想定
      const expectedCenterX = CELL_SIZE / 2;
      const expectedCenterY = index * ROW_HEIGHT + (CELL_SIZE / 2);
      const ALLOWED_TOLERANCE_X = CELL_SIZE / 2 + 50; // 左右は少し余裕を持たせる
      const ALLOWED_TOLERANCE_Y = CELL_SIZE / 2;

      // 該当セルの文字をすべて探し、左から右へ結合する
      const matches = recognizedCharacters.filter(c =>
        Math.abs(c.x - expectedCenterX) < ALLOWED_TOLERANCE_X &&
        Math.abs(c.y - expectedCenterY) < ALLOWED_TOLERANCE_Y
      );

      // 見つかった文字をX座標順（左から右）にソートして文字列にする
      const recognizedText = matches.length > 0 
        ? matches.sort((a, b) => a.x - b.x).map(c => c.text).join("")
        : "";

      // options配列や answer_index を駆使して正解文字を取得
      let correctOptionText = "";
      if (q.answer_index !== undefined && Array.isArray(q.options)) {
        correctOptionText = q.options[q.answer_index - 1] || "";
      } else if (typeof q.answer === "string") {
        correctOptionText = q.answer; // 漢字の答えが直接入っているケース
      }

      const isCorrect = recognizedText === correctOptionText;

      if (isCorrect && recognizedText !== "") {
        correctQuestions.push({ 
          id: q.id, 
          recognizedText: recognizedText,
          correctOptionText,
          question_text: q.question_text
        });
      } else {
        wrongQuestions.push({
          id: q.id,
          recognizedText: recognizedText || "無回答",
          correctOptionText,
          question_text: q.question_text
        });
      }
    });

    serverScore = questions.length > 0 ? Math.round((correctQuestions.length / questions.length) * 100) : 0;

    // 5. XP・レベル計算 (1問正解60XP、コンボボーナス別途があれば入れる。今回はベースの60XPのみとする)
    const baseTotal = correctQuestions.length * 60;
    const finalXpGain = baseTotal;

    // 6. Firestore の書き込み (Users, Leaderboard etc)
    let newLevel = 1;
    let newTotalXp = 0;
    let oldLevel = 1;
    let xpDetailsResult: any;
    let isLevelUp = false;
    let isHighScore = false;

    await db.runTransaction(async (transaction) => {
      const userRef = db.doc(`users/${uid}`);
      const userSnap = await transaction.get(userRef);

      let currentKanjiXp = 0;
      let currentKanjiTotalScore = 0;
      let existingKanjiStats: any = {};

      if (userSnap.exists) {
        const u = userSnap.data()!;
        currentKanjiXp = u.kanjiXp || 0;
        currentKanjiTotalScore = u.kanjiTotalScore || 0;
        existingKanjiStats = u.kanjiUnitStats ? (u.kanjiUnitStats[unitId] || {}) : {};
      }

      const existingMaxScore = existingKanjiStats.maxScore || 0;
      isHighScore = existingMaxScore === undefined || serverScore > existingMaxScore;

      newTotalXp = currentKanjiXp + finalXpGain;
      const oldLevelData = calculateKanjiLevel(currentKanjiXp);
      const newLevelData = calculateKanjiLevel(newTotalXp);

      oldLevel = oldLevelData.level;
      newLevel = newLevelData.level;
      isLevelUp = newLevel > oldLevel;

      xpDetailsResult = {
        base: baseTotal,
        combo: 0,
        multiplier: 1.0,
        multiplierBonus: 0,
        finalXp: finalXpGain
      };

      // wrongQuestionIds の更新 (正解したものは除外し、新しく間違えたものを追加)
      const currentWrong = new Set<string>(existingKanjiStats.wrongQuestionIds || []);
      correctQuestions.forEach(q => currentWrong.delete(q.id));
      wrongQuestions.forEach(q => currentWrong.add(q.id));
      const newWrongQuestionIds = Array.from(currentWrong);

      const userUpdate: any = {
        kanjiXp: newTotalXp,
        kanjiLevel: newLevel,
        kanjiTitle: getKanjiTitle(newLevel),
        kanjiProgressPercent: newLevelData.progressPercent,
        kanjiCurrentLevelXp: newLevelData.currentLevelXp,
        kanjiNextLevelXp: newLevelData.nextLevelXp,
        kanjiUpdatedAt: Timestamp.now().toDate().toISOString(),
        kanjiIcon: "📜", // 文学・漢字を表すアイコン
        kanjiUnitStats: {
          ...(userSnap.exists ? userSnap.data()!.kanjiUnitStats || {} : {}),
          [unitId]: {
            maxScore: Math.max(existingMaxScore, serverScore),
            drillCount: (existingKanjiStats.drillCount || 0) + 1,
            wrongQuestionIds: newWrongQuestionIds
          }
        }
      };

      if (isHighScore) {
        const diff = serverScore - existingMaxScore;
        userUpdate.kanjiTotalScore = FieldValue.increment(diff);
      }

      transaction.set(userRef, userUpdate, { merge: true });

      // リーダーボード更新用情報を受け渡し
      return { success: true };
    });

    // 7. リーダーボード (Leaderboards)
    try {
      await updateKanjiLeaderboard(uid, userName, "📜", newLevel, newTotalXp);
    } catch (e) {
      console.error("Kanji Leaderboard Update Error:", e);
    }

    return {
      success: true,
      score: serverScore,
      isHighScore,
      isLevelUp,
      oldLevel,
      newLevel,
      xpGain: finalXpGain,
      newTotalXp,
      xpDetails: xpDetailsResult,
      correctQuestions,
      wrongQuestions,
      recognizedChars: sortedChars // デバッグ用表示
    };
  });

// ==========================================
// updateKanjiLeaderboard — 漢字専用リーダーボード
// ==========================================
async function updateKanjiLeaderboard(uid: string, userName: string, icon: string, level: number, xp: number) {
  const leaderboardRef = db.doc("leaderboards/kanji");

  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = userSnap.data();
  if (!userData) return;

  const totalScore = userData.kanjiTotalScore || 0;

  const leaderboardSnap = await leaderboardRef.get();
  let rankings: any[] = [];
  if (leaderboardSnap.exists) {
    rankings = leaderboardSnap.data()?.rankings || [];
  }

  const existingIdx = rankings.findIndex((r: any) => r.uid === uid);
  const entry = { uid, name: userName, totalScore, xp, icon, level };

  if (existingIdx >= 0) {
    rankings[existingIdx] = entry;
  } else {
    rankings.push(entry);
  }

  rankings.sort((a: any, b: any) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return b.xp - a.xp;
  });

  rankings = rankings.slice(0, 40);

  await leaderboardRef.set({
    rankings,
    updatedAt: new Date().toISOString(),
  });
}
