import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import vision from "@google-cloud/vision";
import {
  OcrQuestionLayout,
  normalizeKanjiText,
  extractRecognizedCharacters,
  assignRecognizedCharactersToQuestions,
  buildCorrectedTextFromAnswer,
} from "./kanjiOcrCore";

const db = admin.firestore();
const visionClient = new vision.ImageAnnotatorClient();
const KANJI_ACCESS_MAX_FAILURES = 3;

// ==========================================
// 漢字のレベル計算ユーティリティ (literary themes)
// ==========================================
function calculateKanjiLevel(kanjiXp: number) {
  const MAX_LEVEL = 999;
  let level = 1;
  let accumulatedXp = 0;

  while (level < MAX_LEVEL) {
    // Lv1〜999 は一律200XP
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
function clampScore(score: unknown): number {
  const numericScore = Number(score || 0);
  if (!Number.isFinite(numericScore)) return 0;
  return Math.min(100, Math.max(0, Math.round(numericScore)));
}

function calculateKanjiTotalScore(
  unitStats: Record<string, any>,
  activeKanjiUnitIds: Set<string>
): number {
  return Object.entries(unitStats || {}).reduce((total, [statsUnitId, stats]) => {
    if (!activeKanjiUnitIds.has(statsUnitId)) return total;
    return total + clampScore((stats as any)?.maxScore);
  }, 0);
}

function getKanjiAccessPassword(): string {
  return String(process.env.KANJI_ACCESS_PASSWORD || "");
}

export const verifyKanjiAccessPassword = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "認証が必要です。");
    }

    const uid = context.auth.uid;
    const password = String((data as { password?: unknown })?.password || "");
    const userRef = db.doc(`users/${uid}`);
    const expectedPassword = getKanjiAccessPassword();
    if (!expectedPassword) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "漢字モードのパスワードが設定されていません。"
      );
    }

    return db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      const userData = userSnap.exists ? userSnap.data() || {} : {};

      if (userData.kanjiAccessBlocked === true) {
        return { granted: false, blocked: true, remainingAttempts: 0 };
      }

      if (userData.kanjiAccessGranted === true) {
        return {
          granted: true,
          blocked: false,
          remainingAttempts: KANJI_ACCESS_MAX_FAILURES,
        };
      }

      if (password === expectedPassword) {
        transaction.set(userRef, {
          kanjiAccessGranted: true,
          kanjiAccessFailedCount: 0,
          kanjiAccessBlocked: false,
          kanjiAccessGrantedAt: Timestamp.now().toDate().toISOString(),
        }, { merge: true });

        return {
          granted: true,
          blocked: false,
          remainingAttempts: KANJI_ACCESS_MAX_FAILURES,
        };
      }

      const failedCount = Math.min(
        Number(userData.kanjiAccessFailedCount || 0) + 1,
        KANJI_ACCESS_MAX_FAILURES
      );
      const blocked = failedCount >= KANJI_ACCESS_MAX_FAILURES;

      transaction.set(userRef, {
        kanjiAccessFailedCount: failedCount,
        kanjiAccessBlocked: blocked,
        kanjiAccessLastFailedAt: Timestamp.now().toDate().toISOString(),
      }, { merge: true });

      return {
        granted: false,
        blocked,
        remainingAttempts: Math.max(0, KANJI_ACCESS_MAX_FAILURES - failedCount),
      };
    });
  });

export const recognizeKanjiBatch = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "認証が必要です。");
    }

    const { unitId, composedImageBase64, questionIds, layout } = data as {
      unitId: string;
      composedImageBase64: string;
      questionIds?: string[];
      layout?: OcrQuestionLayout[];
    };
    if (!unitId || !composedImageBase64) {
      throw new functions.https.HttpsError("invalid-argument", "unitId と画像のBase64データが必要です。");
    }

    const uid = context.auth.uid;
    const userName = context.auth.token?.name || context.auth.token?.email || "名無し";
    const accessSnap = await db.doc(`users/${uid}`).get();
    const accessData = accessSnap.exists ? accessSnap.data() || {} : {};
    if (accessData.kanjiAccessBlocked === true || accessData.kanjiAccessGranted !== true) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "このユーザーは漢字モードを利用できません。"
      );
    }

    // base64のプレフィックスを取り除く
    const base64Data = composedImageBase64.replace(/^data:image\/\w+;base64,/, "");

    // 1. Vision API 呼び出し
    let visionResult;
    try {
      const [result] = await visionClient.documentTextDetection({
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
      if (unitData.subject !== "kanji") {
        throw new functions.https.HttpsError("failed-precondition", "This unit is not available in kanji mode.");
      }
      let allQuestions: any[] = Array.isArray(unitData.questions) ? unitData.questions : [];
      if (allQuestions.length === 0) {
        const qSnap = await db.collection(`units/${unitId}/questions`).get();
        allQuestions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      }

      if (questionIds && Array.isArray(questionIds) && questionIds.length > 0) {
        const questionMap = new Map(allQuestions.map((q: any) => [q.id, q]));
        questions = questionIds.map(id => questionMap.get(id)).filter(Boolean);
      } else {
        questions = allQuestions;
      }
    }

    // 3. Vision API の認識結果から文字を抽出（kanjiOcrCore の共通関数を使用）
    const recognizedCharacters = extractRecognizedCharacters(visionResult);

    const sortedChars = [...recognizedCharacters].sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    // 4. 正誤判定（kanjiOcrCore の共通関数を使用）
    const layoutMap = new Map<string, OcrQuestionLayout>(
      Array.isArray(layout) ? layout.map((item) => [item.questionId, item]) : []
    );
    const questionCharsMap = assignRecognizedCharactersToQuestions(
      recognizedCharacters,
      Array.from(layoutMap.values())
    );

    const correctQuestions: any[] = [];
    const wrongQuestions: any[] = [];
    const COLUMNS = 1;
    const ROWS = questions.length;

    questions.forEach((q, index) => {
      let resolvedCorrectOptionText = "";
      if (q.answer_index !== undefined && Array.isArray(q.options)) {
        resolvedCorrectOptionText = q.options[q.answer_index - 1] || "";
      } else if (typeof q.answer === "string") {
        resolvedCorrectOptionText = q.answer;
      }

      const questionLayout = layoutMap.get(q.id);
      const hasStructuredLayout = Boolean(questionLayout);
      let recognizedTextFromLayout = "";

      if (questionLayout) {
        const questionChars = (questionCharsMap.get(q.id) || [])
          .sort((a, b) => a.x - b.x);
        recognizedTextFromLayout = buildCorrectedTextFromAnswer(questionChars, questionLayout, resolvedCorrectOptionText);
      }

      const col = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const expectedRelCenterX = (col + 0.5) / COLUMNS;
      const expectedRelCenterY = (row + 0.5) / ROWS;
      const TOLERANCE_X = 0.55 / COLUMNS;
      const TOLERANCE_Y = 0.55 / ROWS;

      const matches = recognizedCharacters.filter(c =>
        Math.abs(c.x - expectedRelCenterX) < TOLERANCE_X &&
        Math.abs(c.y - expectedRelCenterY) < TOLERANCE_Y
      );

      const recognizedText = hasStructuredLayout
        ? recognizedTextFromLayout
        : matches.length > 0
          ? matches.sort((a, b) => a.x - b.x).map(c => c.text).join("")
          : "";

      let correctOptionText = "";
      if (q.answer_index !== undefined && Array.isArray(q.options)) {
        correctOptionText = q.options[q.answer_index - 1] || "";
      } else if (typeof q.answer === "string") {
        correctOptionText = q.answer;
      }

      const isCorrect = normalizeKanjiText(recognizedText) === normalizeKanjiText(resolvedCorrectOptionText);

      if (isCorrect && recognizedText !== "") {
        correctQuestions.push({
          id: q.id,
          recognizedText: recognizedText,
          correctOptionText: resolvedCorrectOptionText,
          question_text: q.question_text
        });
      } else {
        wrongQuestions.push({
          id: q.id,
          recognizedText: recognizedText || "無回答",
          correctOptionText: resolvedCorrectOptionText,
          question_text: q.question_text
        });
      }
    });

    const serverScore = questions.length > 0 ? Math.round((correctQuestions.length / questions.length) * 100) : 0;

    // 5. XP・レベル計算
    const baseTotal = correctQuestions.length * 60;
    const finalXpGain = baseTotal;
    const activeKanjiUnitSnap = await db.collection("units").where("subject", "==", "kanji").get();
    const activeKanjiUnitIds = new Set(activeKanjiUnitSnap.docs.map((doc) => doc.id));

    // 6. Firestore の書き込み
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

      const currentWrong = new Set<string>(existingKanjiStats.wrongQuestionIds || []);
      correctQuestions.forEach(q => currentWrong.delete(q.id));
      wrongQuestions.forEach(q => currentWrong.add(q.id));
      const newWrongQuestionIds = Array.from(currentWrong);
      const previousKanjiUnitStats = userSnap.exists ? userSnap.data()!.kanjiUnitStats || {} : {};
      const nextKanjiUnitStats = {
        ...previousKanjiUnitStats,
        [unitId]: {
          maxScore: Math.max(existingMaxScore, serverScore),
          drillCount: (existingKanjiStats.drillCount || 0) + 1,
          wrongQuestionIds: newWrongQuestionIds
        }
      };
      const recalculatedKanjiTotalScore = calculateKanjiTotalScore(nextKanjiUnitStats, activeKanjiUnitIds);

      const userUpdate: any = {
        kanjiXp: newTotalXp,
        kanjiLevel: newLevel,
        kanjiTitle: getKanjiTitle(newLevel),
        kanjiProgressPercent: newLevelData.progressPercent,
        kanjiCurrentLevelXp: newLevelData.currentLevelXp,
        kanjiNextLevelXp: newLevelData.nextLevelXp,
        kanjiUpdatedAt: Timestamp.now().toDate().toISOString(),
        kanjiIcon: "📜",
        kanjiTotalScore: recalculatedKanjiTotalScore,
        kanjiUnitStats: {
          ...(userSnap.exists ? userSnap.data()!.kanjiUnitStats || {} : {}),
          [unitId]: {
            maxScore: Math.max(existingMaxScore, serverScore),
            drillCount: (existingKanjiStats.drillCount || 0) + 1,
            wrongQuestionIds: newWrongQuestionIds
          }
        }
      };

      transaction.set(userRef, userUpdate, { merge: true });

      return { success: true };
    });

    // 7. リーダーボード
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
      recognizedChars: sortedChars
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
  const storedBadges = userData.kanjiSeasonBadges && typeof userData.kanjiSeasonBadges === "object"
    ? Object.values(userData.kanjiSeasonBadges) as any[]
    : [];
  const badges = [...storedBadges];
  if (!badges.some((badge: any) => badge?.seasonId === "season1") && (userData.kanjiSeason1Badge || userData.kanjiSeason1Certified === true)) {
    badges.push(userData.kanjiSeason1Badge || {
      seasonId: "season1",
      seasonNumber: 1,
      label: "Season 1 認証",
      badgeImageUrl: "/images/kanji-season1-badge.png",
    });
  }
  badges.sort((a: any, b: any) => Number(b.seasonNumber || 0) - Number(a.seasonNumber || 0));
  const latestBadge = badges[0] || null;

  const leaderboardSnap = await leaderboardRef.get();
  let rankings: any[] = [];
  if (leaderboardSnap.exists) {
    rankings = leaderboardSnap.data()?.rankings || [];
  }

  const existingIdx = rankings.findIndex((r: any) => r.uid === uid);
  const entry = {
    uid,
    name: userName,
    totalScore,
    xp,
    icon,
    level,
    badges,
    certified: badges.length > 0,
    badgeImageUrl: latestBadge?.badgeImageUrl || null,
  };

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
