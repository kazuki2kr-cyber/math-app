import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

// ==========================================
// 1. setAdminClaim — 管理者権限の付与/剥奪
// ==========================================
export const setAdminClaim = functions.region("us-central1").https.onCall(async (data, context) => {
  // 呼び出し元が管理者であることを確認
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "管理者のみがこの操作を実行できます。"
    );
  }

  const { email, isAdmin } = data as { email: string; isAdmin: boolean };

  if (!email || typeof isAdmin !== "boolean") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "email (string) と isAdmin (boolean) が必要です。"
    );
  }

  // セキュリティガード: 自分自身の権限は剥奪できない
  if (email === context.auth.token.email && !isAdmin) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "自分自身の管理者権限を剥奪することはできません。他の管理者に依頼してください。"
    );
  }

  try {
    const targetUser = await auth.getUserByEmail(email);
    
    // 1. Auth Custom Claims の更新
    await auth.setCustomUserClaims(targetUser.uid, {
      admin: isAdmin,
    });

    // 2. Firestore ドキュメントの同期 (互換性・UI表示用)
    await db.collection("users").doc(targetUser.uid).set({
      isAdmin: isAdmin,
      updatedAt: Timestamp.now().toDate().toISOString()
    }, { merge: true });

    return { 
      success: true, 
      message: `${email} の管理者権限を ${isAdmin ? "付与" : "剥奪"} し、Firestore データを更新しました。` 
    };
  } catch (error: any) {
    throw new functions.https.HttpsError(
      "not-found",
      `ユーザー ${email} の処理中にエラーが発生しました: ${error.message}`
    );
  }
});

// ==========================================
// 2. processDrillResult — 演習結果の統合処理
// ==========================================
// 選択肢をパース（Firestore の options フィールドが文字列の場合も対応）
function parseOptionsServer(options: any): string[] {
  if (Array.isArray(options)) return options.map(String);
  if (typeof options === "string") {
    try {
      const parsed = JSON.parse(options);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return options.trim() ? options.split(",").map((s: string) => s.trim()) : [];
    }
  }
  return [];
}

export const processDrillResult = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "認証が必要です。");
  }

  // ドメイン制限: フロントエンドと同じルールをサーバーでも強制
  const callerEmail = context.auth.token.email || "";
  const isAllowedDomain = callerEmail.endsWith("@shibaurafzk.com");
  const isIndividualAllowed = callerEmail === "kazuki2kr@gmail.com";
  if (!isAllowedDomain && !isIndividualAllowed) {
    throw new functions.https.HttpsError("permission-denied", "このサービスの対象外アカウントです。");
  }

  const { attemptId, unitId: rawUnitId, time: rawTime, answers } = data as any;
  const unitId = (rawUnitId || "").trim();

  // time の検証: 1秒以上 86400秒以下（クライアント改ざん防止）
  const time = Math.round(Number(rawTime));
  if (!unitId || !Number.isFinite(time) || time < 1 || time > 86400 || !Array.isArray(answers)) {
    console.error("[processDrillResult] Missing required parameters", { unitId, rawTime, answers });
    throw new functions.https.HttpsError("invalid-argument", "必要なパラメータが不足しています。");
  }

  console.log(`[processDrillResult] Started for unitId: ${unitId}, uid: ${context.auth.uid}`);
  console.log(`[processDrillResult] Data summary: time=${time}, answers=${answers?.length}`);

  const safeAnswers: Array<{ questionId: string; selectedOptionText: string }> = answers;

  const uid = context.auth.uid;
  const userName = context.auth.token?.name || context.auth.token?.email || "名無し";
  const now = Timestamp.now();
  const dateStr = now.toDate().toISOString();

  // ==========================================
  // --- 1. サーバー側入力検証（改ざん防止）---
  // 問題ID照合・正誤判定・スコア計算・XP計算をすべてサーバーで行う
  // ==========================================

  // 1-1. 単元ドキュメント取得と問題マップの構築
  const unitDoc = await db.doc(`units/${unitId}`).get();
  if (!unitDoc.exists) {
    throw new functions.https.HttpsError("not-found", "指定された単元が見つかりません。");
  }
  const unitData = unitDoc.data()!;
  // unitTitle はサーバー側の値を使用（クライアント送信値は信頼しない）
  const unitTitle: string = unitData.title || unitId;
  let unitQuestions: any[] = Array.isArray(unitData.questions) ? unitData.questions : [];
  if (unitQuestions.length === 0) {
    // 問題がサブコレクションに格納されている場合のフォールバック
    const qSnap = await db.collection(`units/${unitId}/questions`).get();
    unitQuestions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // 問題ID → 問題データ（parsedOptions 付き）のマップ
  const unitQuestionMap = new Map<string, any>();
  for (const q of unitQuestions) {
    unitQuestionMap.set(String(q.id), { ...q, parsedOptions: parseOptionsServer(q.options) });
  }

  // 1-2. 問題ID照合：送信された全問題IDが当該単元に実在するか確認
  const invalidIds = safeAnswers
    .map(a => String(a.questionId))
    .filter(id => !unitQuestionMap.has(id));
  if (invalidIds.length > 0) {
    console.warn(`[processDrillResult] Invalid question IDs from uid=${uid}:`, invalidIds);
    await db.collection("suspicious_activities").add({
      uid, userName, unitId,
      reasons: [`不正な問題ID ${invalidIds.length}件`],
      timestamp: now,
      details: { time, invalidIds },
    });
    throw new functions.https.HttpsError("invalid-argument", "不正な問題IDが含まれています。");
  }

  // 1-3. サーバー側で正誤判定・スコア計算・XP計算を実施
  const safeCorrectQuestions: any[] = [];
  const safeWrongQuestions: any[] = [];
  const answerOrderForCombo: boolean[] = [];

  for (const answer of safeAnswers) {
    const q = unitQuestionMap.get(String(answer.questionId))!;
    const answerIndex = Number(q.answer_index);
    const correctOptionText = q.parsedOptions[answerIndex - 1] ?? ""; // answer_index は 1-based
    const isCorrect = String(answer.selectedOptionText) === String(correctOptionText);

    answerOrderForCombo.push(isCorrect);

    if (isCorrect) {
      safeCorrectQuestions.push({ id: q.id, question_text: q.question_text });
    } else {
      safeWrongQuestions.push({
        id: q.id,
        question_text: q.question_text,
        selectedOptionText: answer.selectedOptionText,
        correctOptionText,
        explanation: q.explanation || "",
        options: q.parsedOptions,
      });
    }
  }

  const totalAnswered = safeAnswers.length;
  const serverScore: number = Math.min(100, safeCorrectQuestions.length * 10);

  // XP計算（正解順序によるコンボボーナスを含む）
  let baseTotal = 0;
  let comboTotal = 0;
  let currentCombo = 0;
  for (const isCorrect of answerOrderForCombo) {
    if (isCorrect) {
      currentCombo++;
      baseTotal += 10;
      comboTotal += currentCombo;
    } else {
      currentCombo = 0;
    }
  }
  const correctRatio = totalAnswered > 0 ? safeCorrectQuestions.length / totalAnswered : 0;
  let multiplier = 0;
  if (correctRatio === 1) multiplier = 1.5;
  else if (correctRatio >= 0.7) multiplier = 1.0;
  else if (correctRatio >= 0.5) multiplier = 0.5;
  const preMultiplierXp = baseTotal + comboTotal;
  // finalXpGain・xpDetails はトランザクション内で drillCount 参照後に確定

  // alreadyProcessed 時に返すための結果オブジェクト（問題の詳細を含む）
  const questionResults = {
    score: serverScore,
    correctQuestions: safeCorrectQuestions,
    wrongQuestions: safeWrongQuestions,
  };

  try {
    // --- 2. トランザクションによるデータ更新 ---
    const result = await db.runTransaction(async (transaction) => {
    const userRef = db.doc(`users/${uid}`);
    const statsRef = db.doc(`units/${unitId}/stats/questions`);
    const globalStatsRef = db.doc("stats/global");
    
    // Idempotency: attemptIdを使ってすでに記録が存在するか確認
    const attemptDocId = attemptId || db.collection(`users/${uid}/attempts`).doc().id;
    const attemptRef = db.collection(`users/${uid}/attempts`).doc(attemptDocId);

    const [userSnap, attemptSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(attemptRef)
    ]);

    if (attemptSnap.exists) {
      console.log(`[processDrillResult] Attempt ${attemptDocId} is already processed. Bailing out early.`);
      return {
        success: true,
        alreadyProcessed: true,
        isHighScore: false,
        isLevelUp: false,
        xpDetails: { base: 0, combo: 0, multiplier: 0, multiplierBonus: 0, finalXp: 0 },
        _rapidSubmission: null,
        ...questionResults,
      };
    }

    // ③: lastAttemptTimes からインターバルチェック（subcollection クエリ不要・1読み取り削減）
    let _rapidSubmissionSec: number | null = null;
    const lastAttemptTimeStr: string | null = userSnap.exists
      ? (userSnap.data()?.lastAttemptTimes?.[unitId] || null)
      : null;
    if (lastAttemptTimeStr) {
      const lastDateTime = new Date(lastAttemptTimeStr).getTime();
      const diffSec = (now.toMillis() - lastDateTime) / 1000;
      if (diffSec < 30 && totalAnswered >= 10) {
        _rapidSubmissionSec = Math.round(diffSec);
        console.warn(`[processDrillResult] Rapid submission uid=${uid}: ${_rapidSubmissionSec}s`);
      }
    }

    let currentXp = 0;
    let currentIcon = "📐";
    let currentTotalScore = 0;
    if (userSnap.exists) {
      const uData = userSnap.data();
      currentXp = uData?.xp || 0;
      currentIcon = uData?.icon || "📐";
      currentTotalScore = uData?.totalScore || 0;
    }

    // 2-1. スコア更新判定 (High Score) と unitStats マージ
    // ⑥: existingUnitStats 全体ではなく対象単元のデータのみ参照
    const existingUnitData = userSnap.exists ? ((userSnap.data()?.unitStats || {})[unitId] || {}) : {};
    const existingMaxScore = existingUnitData.maxScore || 0;
    const existingBestTime = existingUnitData.bestTime || Infinity;

    let isHighScore = false;
    if (existingUnitData.maxScore === undefined) {
      isHighScore = true;
    } else {
      if (serverScore > existingMaxScore || (serverScore === existingMaxScore && time < existingBestTime)) {
        isHighScore = true;
      }
    }

    // 2-2. drillCount ベースの XP 逓減レート計算
    const drillCount = existingUnitData.drillCount || 0;
    const attemptNumber = drillCount + 1; // 1始まり
    let xpRateMultiplier: number;
    if (attemptNumber <= 3) xpRateMultiplier = 1.0;       // 1〜3回目:  100%
    else if (attemptNumber <= 5) xpRateMultiplier = 0.7;  // 4〜5回目:   70%
    else if (attemptNumber <= 10) xpRateMultiplier = 0.3; // 6〜10回目:  30%
    else xpRateMultiplier = 0;                            // 11回目以降:   0%

    const finalXpGain = Math.floor(preMultiplierXp * multiplier * xpRateMultiplier);
    const xpDetailsResult = {
      base: baseTotal,
      combo: comboTotal,
      multiplier,
      multiplierBonus: finalXpGain - preMultiplierXp,
      finalXp: finalXpGain,
    };

    // 2-3. XP / レベル計算
    const newTotalXp = currentXp + finalXpGain;

    const MAX_LEVEL = 100;
    const calculateLevelAndProgress = (totalXp: number) => {
      let level = 1;
      let accumulatedXp = 0;
      while (level < MAX_LEVEL) {
        const xpForNext = Math.floor(2.2 * Math.pow(level, 2)) + 50;
        if (totalXp >= accumulatedXp + xpForNext) {
          accumulatedXp += xpForNext;
          level++;
        } else {
          const xpIntoCurrentLevel = totalXp - accumulatedXp;
          const progressPercent = Math.min(100, Math.max(0, (xpIntoCurrentLevel / xpForNext) * 100));
          return { level, currentLevelXp: xpIntoCurrentLevel, nextLevelXp: xpForNext, progressPercent };
        }
      }
      return { level: MAX_LEVEL, currentLevelXp: 0, nextLevelXp: 0, progressPercent: 100 };
    };

    const getTitleForLevel = (level: number): string => {
      if (level >= 100) return 'Grandmaster';
      if (level >= 90) return '次世代のオイラー';
      if (level >= 80) return '数学の覇者';
      if (level >= 70) return '数学マスター';
      if (level >= 60) return '数学の賢者';
      if (level >= 50) return '芝浦の数理ハンター';
      if (level >= 40) return '数学のひらめき';
      if (level >= 30) return '論理の探求者';
      if (level >= 20) return '計算の達人';
      if (level >= 10) return '数学ビギナー';
      return '算数卒業生';
    };

    const oldLevelData = calculateLevelAndProgress(currentXp);
    const newLevelData = calculateLevelAndProgress(newTotalXp);
    const oldLevel = oldLevelData.level;
    const newLevel = newLevelData.level;
    const isLevelUp = newLevel > oldLevel;

    // --- 各種書き込み実行 ---
    
    // User Update (XP, totalScore, unitStats, level details)
    const userUpdate: any = { 
      xp: newTotalXp,
      level: newLevel,
      title: getTitleForLevel(newLevel),
      progressPercent: newLevelData.progressPercent,
      currentLevelXp: newLevelData.currentLevelXp,
      nextLevelXp: newLevelData.nextLevelXp,
      updatedAt: dateStr,
      ...(userSnap.exists && currentIcon !== "📐" ? {} : { icon: "📐" })
    };
    
    // ハイスコア更新時に totalScore を差分更新（serverScore を使用）
    if (isHighScore) {
      const scoreDiff = serverScore - existingMaxScore;
      userUpdate.totalScore = FieldValue.increment(scoreDiff);
    }

    // unitStatsの構築 (scoresとwrong_answersを内包)
    // Wrong Answers List (間違えた問題のID配列を保持)
    let currentWrongs: string[] = existingUnitData.wrongQuestionIds || [];
    const newlyCorrectIds = safeCorrectQuestions.map((q: any) => q.id);
    const newlyWrongIds = safeWrongQuestions.map((q: any) => q.id);
    currentWrongs = currentWrongs.filter((id: string) => !newlyCorrectIds.includes(id));
    newlyWrongIds.forEach((id: string) => { if (!currentWrongs.includes(id)) currentWrongs.push(id); });

    // ⑥: ドット記法で対象単元のみ更新（全 unitStats マップの読み書き不要）
    userUpdate[`unitStats.${unitId}`] = {
      ...existingUnitData,
      maxScore: isHighScore ? serverScore : (existingUnitData.maxScore || 0),
      bestTime: isHighScore ? time : (existingUnitData.bestTime ?? null),
      wrongQuestionIds: currentWrongs,
      totalCorrect: (existingUnitData.totalCorrect || 0) + safeCorrectQuestions.length,
      drillCount: drillCount + 1,
      updatedAt: dateStr
    };
    // ③: 次回の間隔チェック用に最終演習時刻を保存（ドット記法で他単元を上書きしない）
    userUpdate[`lastAttemptTimes.${unitId}`] = dateStr;

    transaction.set(userRef, userUpdate, { merge: true });

    // Attempts (Subcollection) - トランザクション内で事前作成した attemptRef を使用
    // TTL用 expireAt: 90日後に自動削除対象
    const expireAt = new Date(now.toDate().getTime() + 90 * 24 * 60 * 60 * 1000);
    transaction.set(attemptRef, {
      uid, userName, // Admin画面でAttemptsベースの集計をするためにuid/userNameを保存
      unitId, unitTitle, score: serverScore, time, date: dateStr,
      xpGain: finalXpGain,
      expireAt: Timestamp.fromDate(expireAt),
      details: [
        ...safeCorrectQuestions.map((q: any) => ({ qId: q.id, isCorrect: true })),
        ...safeWrongQuestions.map((q: any) => ({ qId: q.id, isCorrect: false }))
      ]
    });

    // Stats (Aggregated)
    const statsUpdate: any = {};
    safeCorrectQuestions.forEach((q: any) => {
      statsUpdate[`${q.id}.correct`] = FieldValue.increment(1);
      statsUpdate[`${q.id}.total`] = FieldValue.increment(1);
    });
    safeWrongQuestions.forEach((q: any) => {
      statsUpdate[`${q.id}.total`] = FieldValue.increment(1);
    });
    transaction.set(statsRef, statsUpdate, { merge: true });

    // Global Stats (管理画面用の集計データ)
    const globalStatsUpdate: any = {
      totalDrills: FieldValue.increment(1),
      totalCorrect: FieldValue.increment(safeCorrectQuestions.length),
      totalAnswered: FieldValue.increment(safeCorrectQuestions.length + safeWrongQuestions.length),
      updatedAt: dateStr
    };
    // 新規参加者（初めてスコアを獲得するユーザー）の場合、カウンターをインクリメント
    if (isHighScore && currentTotalScore === 0) {
      globalStatsUpdate.totalParticipants = FieldValue.increment(1);
    }
    transaction.set(globalStatsRef, globalStatsUpdate, { merge: true });

    return {
      success: true,
      isHighScore,
      isLevelUp,
      oldLevel,
      newLevel,
      xpGain: finalXpGain,
      newTotalXp,
      xpDetails: xpDetailsResult,
      ...questionResults,
      // リーダーボード更新に必要な情報を返す
      // isHighScore（スコア更新）または finalXpGain > 0（XP増加）の場合に更新する。
      // 11回目以降でXP増加もハイスコアもない場合は無駄な書き込みを避けるためスキップ。
      _leaderboardUpdate: (isHighScore || finalXpGain > 0)
        ? { uid, userName, currentIcon, newLevel, newTotalXp }
        : null,
      _rapidSubmission: _rapidSubmissionSec,
    };
  });

  // --- 3. トランザクション後の非クリティカル処理 ---
  const resultAny = result as any;

  // 不審アクティビティ（短時間の連続演習）をログ記録
  if (resultAny._rapidSubmission !== null && resultAny._rapidSubmission !== undefined) {
    try {
      await db.collection("suspicious_activities").add({
        uid, userName, unitId,
        reasons: [`異常に短い演習間隔: ${resultAny._rapidSubmission}秒`],
        timestamp: now,
        details: { score: serverScore, time, correctCount: safeCorrectQuestions.length },
      });
    } catch (e) {
      console.error("[processDrillResult] Suspicious activity log error (non-critical):", e);
    }
  }

  // リーダーボード更新（isHighScore または XP増加がある場合のみ）
  if (resultAny._leaderboardUpdate) {
    try {
      await updateLeaderboard(resultAny._leaderboardUpdate);
    } catch (leaderboardErr) {
      console.error("[processDrillResult] Leaderboard update failed (non-critical):", leaderboardErr);
    }
  }

  // 内部フィールドはクライアントに返さない
  const { _leaderboardUpdate: _lb, _rapidSubmission: _rs, ...clientResult } = resultAny;
  return clientResult;

} catch (error: any) {
  console.error("[processDrillResult] Transaction failed:", error);
  console.error("[processDrillResult] Stack trace:", error.stack);
  // 内部エラー詳細はログのみ。クライアントには汎用メッセージを返す
  if (error instanceof functions.https.HttpsError) throw error;
  throw new functions.https.HttpsError("internal", "内部処理エラーが発生しました。");
}
});

// ==========================================
// 3. updateLeaderboard — リーダーボード更新ヘルパー
// ==========================================
async function updateLeaderboard(info: {
  uid: string;
  userName: string;
  currentIcon: string;
  newLevel: number;
  newTotalXp: number;
}) {
  const leaderboardRef = db.doc("leaderboards/overall");

  // ユーザードキュメントから最新のtotalScoreを取得
  const userSnap = await db.doc(`users/${info.uid}`).get();
  const userData = userSnap.data();
  if (!userData) return;

  const totalScore = userData.totalScore || 0;
  const xp = userData.xp || 0;
  // icon と level もユーザードキュメントから最新値を取得（アイコン変更の反映遅延を防ぐ）
  const icon = userData.icon || info.currentIcon;
  const level = userData.level || info.newLevel;

  const leaderboardSnap = await leaderboardRef.get();
  let rankings: any[] = [];

  if (leaderboardSnap.exists) {
    rankings = leaderboardSnap.data()?.rankings || [];
  }

  // 既存エントリを更新 or 新規追加
  const existingIdx = rankings.findIndex((r: any) => r.uid === info.uid);
  const entry = {
    uid: info.uid,
    name: info.userName,
    totalScore,
    xp,
    icon,
    level,
  };

  if (existingIdx >= 0) {
    rankings[existingIdx] = entry;
  } else {
    rankings.push(entry);
  }

  // ソート: totalScore 降順 → xp 降順
  rankings.sort((a: any, b: any) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return b.xp - a.xp;
  });

  // 上位40名のみ保持
  rankings = rankings.slice(0, 40);


  // 参加者数を stats/global カウンターから取得（全ユーザー走査を回避）
  const globalStatsSnap = await db.doc("stats/global").get();
  const totalParticipants = globalStatsSnap.exists ? (globalStatsSnap.data()?.totalParticipants || rankings.length) : rankings.length;

  await leaderboardRef.set({
    rankings,
    totalParticipants,
    updatedAt: new Date().toISOString(),
  });

  console.log(`[updateLeaderboard] Updated: ${rankings.length} entries, ${totalParticipants} total participants`);
}

// ==========================================
// initializeAdminClaims — 初回セットアップ用
// (セキュリティ向上のため削除済み)
// ==========================================

// ==========================================
// 4. listAdmins — 管理者一覧を取得
// ==========================================
export const listAdmins = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "管理者のみがこの操作を実行できます。"
    );
  }

  const admins: Array<{ uid: string; email: string; displayName: string }> = [];

  // Firebase Auth の全ユーザーを走査して admin Claim を持つユーザーを抽出
  let nextPageToken: string | undefined;
  do {
    const listResult = await auth.listUsers(1000, nextPageToken);
    for (const userRecord of listResult.users) {
      if (userRecord.customClaims?.admin === true) {
        admins.push({
          uid: userRecord.uid,
          email: userRecord.email || "",
          displayName: userRecord.displayName || "名前なし",
        });
      }
    }
    nextPageToken = listResult.pageToken;
  } while (nextPageToken);

  return { admins };
});
