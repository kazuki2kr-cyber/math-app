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

  try {
    const targetUser = await auth.getUserByEmail(email);
    await auth.setCustomUserClaims(targetUser.uid, {
      admin: isAdmin,
    });
    return { success: true, message: `${email} の管理者権限を ${isAdmin ? "付与" : "剥奪"} しました。` };
  } catch (error: any) {
    throw new functions.https.HttpsError(
      "not-found",
      `ユーザー ${email} が見つかりません: ${error.message}`
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

  const { unitId, unitTitle, score, time, correctQuestions, wrongQuestions, xpDetails } = data as any;

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
    return await db.runTransaction(async (transaction) => {
    const userRef = db.doc(`users/${uid}`);
    const scoreRef = db.doc(`scores/${uid}_${unitId}`);
    const statsRef = db.doc(`units/${unitId}/stats/questions`);
    const wrongDocRef = db.doc(`users/${uid}/wrong_answers/${unitId}`);
    
    const userSnap = await transaction.get(userRef);
    const scoreSnap = await transaction.get(scoreRef);
    const wrongSnap = await transaction.get(wrongDocRef);

    let currentXp = 0;
    let currentIcon = "📐";
    if (userSnap.exists) {
      const uData = userSnap.data();
      currentXp = uData?.xp || 0;
      currentIcon = uData?.icon || "📐";
    }

    // 2-1. XP / レベル計算
    const finalXpGain = xpDetails?.finalXp || 0;
    const newTotalXp = currentXp + finalXpGain;
    
    // フロントエンドのロジックと同期 (便宜上 here)
    const calculateLevel = (xp: number) => Math.floor(Math.sqrt(xp / 10)) + 1;
    const oldLevel = calculateLevel(currentXp);
    const newLevel = calculateLevel(newTotalXp);
    const isLevelUp = newLevel > oldLevel;

    // 2-2. スコア更新判定 (High Score)
    let isHighScore = false;
    if (scoreSnap.exists) {
      const sData = scoreSnap.data();
      if (score > sData?.maxScore || (score === sData?.maxScore && time < sData?.bestTime)) {
        isHighScore = true;
      }
    } else {
      isHighScore = true;
    }

    // --- 各種書き込み実行 ---
    
    // User Update (XP)
    transaction.set(userRef, { 
      xp: newTotalXp,
      updatedAt: dateStr,
      ...(userSnap.exists ? {} : { icon: "📐" })
    }, { merge: true });

    // Score Update (Denormalized)
    if (isHighScore || isLevelUp) {
      transaction.set(scoreRef, {
        uid, userName, unitId,
        maxScore: isHighScore ? score : (scoreSnap.exists ? scoreSnap.data()?.maxScore : score),
        bestTime: isHighScore ? time : (scoreSnap.exists ? scoreSnap.data()?.bestTime : time),
        updatedAt: dateStr,
        icon: currentIcon,
        level: newLevel
      }, { merge: true });
    }

    // Attempts (Subcollection) - トランザクション内でのaddはリファレンス経由
    const attemptRef = userRef.collection("attempts").doc();
    transaction.set(attemptRef, {
      unitId, unitTitle, score, time, date: dateStr,
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

    // Wrong Answers List
    let currentWrongs: string[] = wrongSnap.exists ? (wrongSnap.data()?.wrongQuestionIds || []) : [];
    const newlyCorrectIds = safeCorrectQuestions.map((q: any) => q.id);
    const newlyWrongIds = safeWrongQuestions.map((q: any) => q.id);
    currentWrongs = currentWrongs.filter(id => !newlyCorrectIds.includes(id));
    newlyWrongIds.forEach(id => { if (!currentWrongs.includes(id)) currentWrongs.push(id); });
    
    transaction.set(wrongDocRef, {
      unitId, wrongQuestionIds: currentWrongs, lastUpdated: dateStr
    }, { merge: true });

    return {
      success: true,
      isHighScore,
      isLevelUp,
      oldLevel,
      newLevel,
      xpGain: finalXpGain,
      newTotalXp
    };
  });
} catch (error: any) {
  console.error("[processDrillResult] Transaction failed:", error);
  console.error("[processDrillResult] Stack trace:", error.stack);
  throw new functions.https.HttpsError("internal", error.message || "内部処理エラーが発生しました。");
}
});

// ==========================================
// 3. initializeAdminClaims — 初回セットアップ用
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
