import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import vision from "@google-cloud/vision";

const db = admin.firestore();
const visionClient = new vision.ImageAnnotatorClient();

interface RecognizedCharacter {
  text: string;
  x: number;
  y: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface OcrSlotLayout {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OcrQuestionLayout {
  questionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  expectedCharCount: number;
  slots: OcrSlotLayout[];
}

const KANJI_CONFUSION_GROUPS = [
  ["一", "ー", "丨"],
  ["口", "日", "目"],
  ["土", "士"],
  ["木", "本", "未", "末"],
  ["人", "入"],
  ["大", "犬", "太"],
  ["傍", "防", "坊", "旁"],
  ["観", "視", "見"],
  ["俗", "浴", "谷"],
  ["絶", "紹"],
  ["叫", "叶"],
  ["業", "寒"],
  ["偉", "緯", "違"],
];

function normalizeKanjiText(text: string): string {
  return (text || "").normalize("NFKC").replace(/\s+/g, "");
}

function isWithinBox(
  point: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
  marginX = 0,
  marginY = 0
): boolean {
  return (
    point.x >= box.x - marginX &&
    point.x <= box.x + box.width + marginX &&
    point.y >= box.y - marginY &&
    point.y <= box.y + box.height + marginY
  );
}

function getOverlapRatio(
  char: Pick<RecognizedCharacter, "left" | "right" | "top" | "bottom">,
  box: { x: number; y: number; width: number; height: number }
): number {
  const overlapWidth = Math.max(0, Math.min(char.right, box.x + box.width) - Math.max(char.left, box.x));
  const overlapHeight = Math.max(0, Math.min(char.bottom, box.y + box.height) - Math.max(char.top, box.y));
  const overlapArea = overlapWidth * overlapHeight;
  const charArea = Math.max((char.right - char.left) * (char.bottom - char.top), 0.000001);
  return overlapArea / charArea;
}

function getCharMatchBonus(recognized: string, expected: string): number {
  if (!recognized || !expected) return 0;
  if (normalizeKanjiText(recognized) === normalizeKanjiText(expected)) {
    return 8;
  }

  for (const group of KANJI_CONFUSION_GROUPS) {
    if (group.includes(recognized) && group.includes(expected)) {
      return 3.5;
    }
  }

  return 0;
}

function scoreCharForSlot(
  char: RecognizedCharacter,
  slot: { x: number; y: number; width: number; height: number },
  expectedChar = ""
): number {
  const slotCenterX = slot.x + slot.width / 2;
  const slotCenterY = slot.y + slot.height / 2;
  const distance = Math.sqrt(distanceSquared(char, slotCenterX, slotCenterY));
  const normalizedDistance = distance / Math.max(Math.max(slot.width, slot.height), 0.000001);
  const overlapRatio = getOverlapRatio(char, slot);
  const withinSlot = isWithinBox(char, slot, slot.width * 0.18, slot.height * 0.15);
  const areaRatio = Math.min((char.width * char.height) / Math.max(slot.width * slot.height, 0.000001), 1);

  return (
    getCharMatchBonus(char.text, expectedChar) +
    overlapRatio * 3 +
    (withinSlot ? 1.5 : 0) +
    areaRatio * 0.6 -
    normalizedDistance * 1.8
  );
}

function scoreCharForQuestion(
  char: RecognizedCharacter,
  questionLayout: OcrQuestionLayout
): number {
  const questionCenterX = questionLayout.x + questionLayout.width / 2;
  const questionCenterY = questionLayout.y + questionLayout.height / 2;
  const distance = Math.sqrt(distanceSquared(char, questionCenterX, questionCenterY));
  const normalizedDistance = distance / Math.max(questionLayout.width, questionLayout.height, 0.000001);
  const overlapRatio = getOverlapRatio(char, questionLayout);
  const withinQuestion = isWithinBox(char, questionLayout, questionLayout.width * 0.01, questionLayout.height * 0.005);

  return overlapRatio * 4 + (withinQuestion ? 1 : 0) - normalizedDistance * 0.75;
}

function buildFallbackSlots(questionLayout: OcrQuestionLayout, charCount: number): OcrSlotLayout[] {
  const slotCount = Math.max(1, charCount);
  const slotWidth = questionLayout.width / slotCount;
  return Array.from({ length: slotCount }, (_, index) => ({
    index,
    x: questionLayout.x + slotWidth * index,
    y: questionLayout.y,
    width: slotWidth,
    height: questionLayout.height,
  }));
}

function distanceSquared(point: { x: number; y: number }, targetX: number, targetY: number): number {
  const dx = point.x - targetX;
  const dy = point.y - targetY;
  return dx * dx + dy * dy;
}

function assignRecognizedCharactersToQuestions(
  recognizedCharacters: RecognizedCharacter[],
  layouts: OcrQuestionLayout[]
): Map<string, RecognizedCharacter[]> {
  const charsByQuestionId = new Map<string, RecognizedCharacter[]>();

  layouts.forEach((layout) => {
    charsByQuestionId.set(layout.questionId, []);
  });

  recognizedCharacters.forEach((char) => {
    const candidates = layouts
      .map((layout) => ({
        layout,
        score: scoreCharForQuestion(char, layout),
        overlapRatio: getOverlapRatio(char, layout),
        withinQuestion: isWithinBox(char, layout, layout.width * 0.01, layout.height * 0.005),
      }))
      .filter(({ overlapRatio, withinQuestion }) => overlapRatio > 0 || withinQuestion)
      .sort((a, b) => b.score - a.score);

    const bestCandidate = candidates[0];
    if (!bestCandidate) {
      return;
    }

    if (!bestCandidate.withinQuestion && bestCandidate.overlapRatio < 0.08) {
      return;
    }

    charsByQuestionId.get(bestCandidate.layout.questionId)?.push(char);
  });

  return charsByQuestionId;
}

function buildRecognizedTextFromLayout(
  questionChars: RecognizedCharacter[],
  questionLayout: OcrQuestionLayout
): string {
  const sortedSlots = [...(questionLayout.slots || [])].sort((a, b) => a.index - b.index);
  if (sortedSlots.length <= 1) {
    if (questionChars.length === 0) return "";
    const centerX = questionLayout.x + questionLayout.width / 2;
    const centerY = questionLayout.y + questionLayout.height / 2;
    const bestChar = [...questionChars].sort(
      (a, b) => distanceSquared(a, centerX, centerY) - distanceSquared(b, centerX, centerY)
    )[0];
    return bestChar?.text || "";
  }

  const usedIndices = new Set<number>();

  return sortedSlots.map((slot) => {
    const slotCandidates = questionChars
      .map((char, index) => ({ char, index }))
      .filter(({ char, index }) => !usedIndices.has(index) && isWithinBox(char, slot, 0.015, 0.02));

    if (slotCandidates.length === 0) {
      return "";
    }

    const slotCenterX = slot.x + slot.width / 2;
    const slotCenterY = slot.y + slot.height / 2;
    const bestCandidate = slotCandidates.sort(
      (a, b) => distanceSquared(a.char, slotCenterX, slotCenterY) - distanceSquared(b.char, slotCenterX, slotCenterY)
    )[0];

    usedIndices.add(bestCandidate.index);
    return bestCandidate.char.text;
  }).join("");
}

function buildCorrectedTextFromAnswer(
  questionChars: RecognizedCharacter[],
  questionLayout: OcrQuestionLayout,
  correctAnswer: string
): string {
  const normalizedAnswer = normalizeKanjiText(correctAnswer);
  if (!normalizedAnswer) {
    return buildRecognizedTextFromLayout(questionChars, questionLayout);
  }

  const answerChars = Array.from(normalizedAnswer);
  const slots = (questionLayout.slots && questionLayout.slots.length > 0)
    ? [...questionLayout.slots].sort((a, b) => a.index - b.index)
    : buildFallbackSlots(questionLayout, answerChars.length);

  const rawText = buildRecognizedTextFromLayout(questionChars, questionLayout);
  const rawNormalized = normalizeKanjiText(rawText);
  if (rawNormalized === normalizedAnswer) {
    return normalizedAnswer;
  }

  const usedIndices = new Set<number>();
  const correctedChars = answerChars.map((expectedChar, index) => {
    const slot = slots[Math.min(index, slots.length - 1)] || {
      x: questionLayout.x,
      y: questionLayout.y,
      width: questionLayout.width,
      height: questionLayout.height,
    };

    const candidates = questionChars
      .map((char, charIndex) => ({
        char,
        charIndex,
        score: scoreCharForSlot(char, slot, expectedChar),
      }))
      .filter(({ score }) => score > -1.25)
      .sort((a, b) => b.score - a.score);

    const exactCandidate = candidates.find(({ char, charIndex }) =>
      !usedIndices.has(charIndex) && normalizeKanjiText(char.text) === expectedChar
    );
    if (exactCandidate) {
      usedIndices.add(exactCandidate.charIndex);
      return exactCandidate.char.text;
    }

    const bestCandidate = candidates.find(({ charIndex }) => !usedIndices.has(charIndex));
    if (!bestCandidate) {
      return "";
    }

    const fallbackThreshold = getCharMatchBonus(bestCandidate.char.text, expectedChar) > 0 ? -3 : 2.1;
    if (bestCandidate.score < fallbackThreshold) {
      return "";
    }

    usedIndices.add(bestCandidate.charIndex);
    return bestCandidate.char.text;
  }).join("");

  const correctedNormalized = normalizeKanjiText(correctedChars);
  if (correctedNormalized === normalizedAnswer) {
    return normalizedAnswer;
  }

  const exactCoverage = answerChars.every((expectedChar) =>
    questionChars.some((char) => normalizeKanjiText(char.text) === expectedChar)
  );
  if (exactCoverage) {
    return normalizedAnswer;
  }

  return correctedChars || rawText;
}

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

    // base64のプレフィックスを取り除く
    const base64Data = composedImageBase64.replace(/^data:image\/\w+;base64,/, "");

    // 1. Vision API 呼び出し
    let visionResult;
    try {
      // documentTextDetection に戻し、文字（symbol）レベルの正確な座標情報を取得する
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
    const recognizedCharacters: RecognizedCharacter[] = [];
    
    // 画像サイズを正規化のために取得
    const fullTextAnnotation = visionResult.fullTextAnnotation;
    const pages = fullTextAnnotation?.pages || [];
    const imgWidth = pages[0]?.width || 1;
    const imgHeight = pages[0]?.height || 1;

    for (const page of pages) {
      for (const block of page.blocks || []) {
        for (const paragraph of block.paragraphs || []) {
          for (const word of paragraph.words || []) {
            for (const symbol of word.symbols || []) {
              if (!symbol.text) continue;

              // 日本語以外の文字をフィルタリング
              const char = symbol.text;
              if (!/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(char)) continue;

              const vertices = symbol.boundingBox?.vertices || [];
              if (vertices.length > 0) {
                const xs = vertices.map(v => v.x || 0);
                const ys = vertices.map(v => v.y || 0);
                const minX = Math.min(...xs);
                const maxX = Math.max(...xs);
                const minY = Math.min(...ys);
                const maxY = Math.max(...ys);
                const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
                const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;

                // 相対座標 (0.0 - 1.0) に変換
                recognizedCharacters.push({
                  text: char,
                  x: avgX / imgWidth,
                  y: avgY / imgHeight,
                  left: minX / imgWidth,
                  right: maxX / imgWidth,
                  top: minY / imgHeight,
                  bottom: maxY / imgHeight,
                  width: Math.max((maxX - minX) / imgWidth, 0.000001),
                  height: Math.max((maxY - minY) / imgHeight, 0.000001),
                });
              }
            }
          }
        }
      }
    }

    // 縦1列レイアウト (COLUMNS=1) に基づいた相対座標判定
    const COLUMNS = 1;
    const ROWS = questions.length;

    const sortedChars = [...recognizedCharacters].sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    // 4. 正誤判定の実行
    // 空欄だった場合はスキップされるため、インデックスがずれる可能性がある。
    // そのため、回答者の書いた文字の座標(row, col) を厳密に計算して問題インデックスと照らし合わせる
    const correctQuestions: any[] = [];
    const wrongQuestions: any[] = [];
    let serverScore = 0;
    const layoutMap = new Map<string, OcrQuestionLayout>(
      Array.isArray(layout) ? layout.map((item) => [item.questionId, item]) : []
    );
    const questionCharsMap = assignRecognizedCharactersToQuestions(
      recognizedCharacters,
      Array.from(layoutMap.values())
    );

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

      // 割合ベースで期待される座標を計算
      const col = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      
      const expectedRelCenterX = (col + 0.5) / COLUMNS;
      const expectedRelCenterY = (row + 0.5) / ROWS;
      
      // 許容誤差を割合で設定 (セルの大きさの 55% 程度)
      const TOLERANCE_X = 0.55 / COLUMNS;
      const TOLERANCE_Y = 0.55 / ROWS;

      // 該当エリア内の文字を抽出し、X座標の割合順（左から右）に結合
      const matches = recognizedCharacters.filter(c =>
        Math.abs(c.x - expectedRelCenterX) < TOLERANCE_X &&
        Math.abs(c.y - expectedRelCenterY) < TOLERANCE_Y
      );

      // 見つかった文字をX座標順（左から右）にソートして文字列にする
      const recognizedText = hasStructuredLayout
        ? recognizedTextFromLayout
        : matches.length > 0
          ? matches.sort((a, b) => a.x - b.x).map(c => c.text).join("")
          : "";

      // options配列や answer_index を駆使して正解文字を取得
      let correctOptionText = "";
      if (q.answer_index !== undefined && Array.isArray(q.options)) {
        correctOptionText = q.options[q.answer_index - 1] || "";
      } else if (typeof q.answer === "string") {
        correctOptionText = q.answer; // 漢字の答えが直接入っているケース
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
