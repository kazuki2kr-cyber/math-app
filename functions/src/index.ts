import * as functions from "firebase-functions";
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
export const processDrillResult = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "認証が必要です。");
  }

  const { attemptId, unitId, unitTitle, score, time, correctQuestions, wrongQuestions, xpDetails } = data as any;

  console.log(`[processDrillResult] Started for unitId: ${unitId}, uid: ${context.auth.uid}`);
  console.log(`[processDrillResult] Data summary: score=${score}, time=${time}, correct=${correctQuestions?.length}, wrong=${wrongQuestions?.length}`);

  if (!unitId || score === undefined || time === undefined) {
    console.error("[processDrillResult] Missing required parameters", { unitId, score, time });
    throw new functions.https.HttpsError("invalid-argument", "必要なパラメータが不足しています。");
  }

  // 配列が未定義の場合のフォールバック
  const safeCorrectQuestions = Array.isArray(correctQuestions) ? correctQuestions : [];
  const safeWrongQuestions = Array.isArray(wrongQuestions) ? wrongQuestions : [];

  const uid = context.auth.uid;
  const userName = context.auth.token?.name || context.auth.token?.email || "名無し";
  const now = Timestamp.now();
  const dateStr = now.toDate().toISOString();

  // --- 1. 不審なアクティビティの検証 ---
  const suspiciousReasons: string[] = [];
  try {
    const unitDoc = await db.doc(`units/${unitId}`).get();
    if (!unitDoc.exists) {
      suspiciousReasons.push(`ユニットが存在しません: ${unitId}`);
    }
    
    // 演習間隔チェック
    const latestAttempt = await db.collection(`users/${uid}/attempts`)
      .where("unitId", "==", unitId)
      .orderBy("date", "desc")
      .limit(1)
      .get();

    if (!latestAttempt.empty) {
      const lastData = latestAttempt.docs[0].data();
      const lastDateStr = lastData?.date;
      if (lastDateStr) {
        const lastDateTime = new Date(lastDateStr).getTime();
        const diffSec = (now.toMillis() - lastDateTime) / 1000;
        if (diffSec < 30 && (safeCorrectQuestions.length + safeWrongQuestions.length) >= 10) {
          suspiciousReasons.push(`異常に短い演習間隔: ${Math.round(diffSec)}秒`);
        }
      }
    }

    if (score > 100) suspiciousReasons.push(`スコア不正: ${score}`);

    if (suspiciousReasons.length > 0) {
      await db.collection("suspicious_activities").add({
        uid, userName, unitId, reasons: suspiciousReasons, timestamp: now,
        details: { score, time, correctCount: safeCorrectQuestions.length }
      });
    }
  } catch (e) { 
    console.error("[processDrillResult] Validation error:", e); 
    // バリデーションエラーで処理全体を止めない
  }

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
        isLevelUp: false
      };
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

    // 2-1. XP / レベル計算
    const finalXpGain = xpDetails?.finalXp || 0;
    const newTotalXp = currentXp + finalXpGain;
    
    // XPとレベル、称号、進捗の計算
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

    // 2-2. スコア更新判定 (High Score) と unitStats マージ
    // 従来の scores コレクションを置き換えるため、userSnap から取得
    const existingUnitStats = userSnap.exists ? (userSnap.data()?.unitStats || {}) : {};
    const existingUnitData = existingUnitStats[unitId] || {};
    const existingMaxScore = existingUnitData.maxScore || 0;
    const existingBestTime = existingUnitData.bestTime || Infinity;
    
    let isHighScore = false;
    if (existingUnitData.maxScore === undefined) {
      isHighScore = true;
    } else {
      if (score > existingMaxScore || (score === existingMaxScore && time < existingBestTime)) {
        isHighScore = true;
      }
    }

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
    
    // ハイスコア更新時に totalScore を差分更新
    if (isHighScore) {
      const scoreDiff = score - existingMaxScore;
      userUpdate.totalScore = FieldValue.increment(scoreDiff);
    }

    // unitStatsの構築 (scoresとwrong_answersを内包)
    // Wrong Answers List (間違えた問題のID配列を保持)
    let currentWrongs: string[] = existingUnitData.wrongQuestionIds || [];
    const newlyCorrectIds = safeCorrectQuestions.map((q: any) => q.id);
    const newlyWrongIds = safeWrongQuestions.map((q: any) => q.id);
    currentWrongs = currentWrongs.filter((id: string) => !newlyCorrectIds.includes(id));
    newlyWrongIds.forEach((id: string) => { if (!currentWrongs.includes(id)) currentWrongs.push(id); });

    userUpdate[`unitStats.${unitId}.maxScore`] = isHighScore ? score : existingMaxScore;
    userUpdate[`unitStats.${unitId}.bestTime`] = isHighScore ? time : (existingBestTime === Infinity ? time : existingBestTime);
    userUpdate[`unitStats.${unitId}.wrongQuestionIds`] = currentWrongs;
    userUpdate[`unitStats.${unitId}.totalCorrect`] = FieldValue.increment(safeCorrectQuestions.length);
    userUpdate[`unitStats.${unitId}.updatedAt`] = dateStr;

    transaction.set(userRef, userUpdate, { merge: true });

    // Attempts (Subcollection) - トランザクション内で事前作成した attemptRef を使用
    // TTL用 expireAt: 90日後に自動削除対象
    const expireAt = new Date(now.toDate().getTime() + 90 * 24 * 60 * 60 * 1000);
    transaction.set(attemptRef, {
      uid, userName, // Admin画面でAttemptsベースの集計をするためにuid/userNameを保存
      unitId, unitTitle, score, time, date: dateStr,
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
      // リーダーボード更新に必要な情報を返す
      _leaderboardUpdate: isHighScore ? { uid, userName, currentIcon, newLevel, newTotalXp } : null
    };
  });

  // --- 3. トランザクション後にリーダーボード更新（非同期・ベストエフォート） ---
  if (result._leaderboardUpdate) {
    try {
      await updateLeaderboard(result._leaderboardUpdate);
    } catch (leaderboardErr) {
      console.error("[processDrillResult] Leaderboard update failed (non-critical):", leaderboardErr);
      // リーダーボード更新失敗はユーザーには影響しない
    }
  }

  // _leaderboardUpdate はクライアントに返さない
  const { _leaderboardUpdate, ...clientResult } = result;
  return clientResult;

} catch (error: any) {
  console.error("[processDrillResult] Transaction failed:", error);
  console.error("[processDrillResult] Stack trace:", error.stack);
  throw new functions.https.HttpsError("internal", error.message || "内部処理エラーが発生しました。");
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
    icon: info.currentIcon,
    level: info.newLevel,
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
