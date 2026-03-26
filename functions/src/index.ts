import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

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
// 2. updateQuestionStats — 演習結果のstats更新
// ==========================================
export const updateQuestionStats = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証が必要です。"
    );
  }

  const { unitId, correctQuestionIds, wrongQuestionIds } = data as {
    unitId: string;
    correctQuestionIds: string[];
    wrongQuestionIds: string[];
  };

  if (!unitId || !Array.isArray(correctQuestionIds) || !Array.isArray(wrongQuestionIds)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "unitId, correctQuestionIds, wrongQuestionIds が必要です。"
    );
  }

  const uid = context.auth.uid;
  const now = admin.firestore.Timestamp.now();
  const suspiciousReasons: string[] = [];

  try {
    // 1. 存在しないIDの検証
    const unitDoc = await db.doc(`units/${unitId}`).get();
    if (!unitDoc.exists) {
      suspiciousReasons.push(`ユニットが存在しません: ${unitId}`);
    } else {
      const unitData = unitDoc.data();
      const validIds = new Set((unitData?.questions || []).map((q: any) => q.id));
      
      const invalidIds = [...correctQuestionIds, ...wrongQuestionIds].filter(id => !validIds.has(id));
      if (invalidIds.length > 0) {
        suspiciousReasons.push(`存在しない問題IDの報告: ${invalidIds.join(", ")}`);
      }
    }

    // 2. 物理的限界速度の検証 (前回の同一ユニット演習からの間隔)
    const latestAttempt = await db.collection(`users/${uid}/attempts`)
      .where("unitId", "==", unitId)
      .orderBy("date", "desc")
      .limit(1)
      .get();

    if (!latestAttempt.empty) {
      const lastDateStr = latestAttempt.docs[0].data().date;
      const lastDate = new Date(lastDateStr).getTime();
      const diffSec = (now.toMillis() - lastDate) / 1000;

      // 10問以上の演習で、前回の完了から30秒以内は極めて不自然（演出時間等を考慮）
      if (diffSec < 30 && (correctQuestionIds.length + wrongQuestionIds.length) >= 10) {
        suspiciousReasons.push(`異常に短い演習間隔: 前回から ${Math.round(diffSec)}秒`);
      }
    }

    // 不審な点があれば記録
    if (suspiciousReasons.length > 0) {
      await db.collection("suspicious_activities").add({
        uid,
        userName: context.auth.token.name || context.auth.token.email || "Unknown",
        unitId,
        reasons: suspiciousReasons,
        timestamp: now,
        details: {
          correctCount: correctQuestionIds.length,
          wrongCount: wrongQuestionIds.length,
        }
      });
    }
  } catch (error) {
    console.error("Suspicious detection error (non-blocking):", error);
  }

  // 既存の統計更新ロジック (維持)
  const statsRef = db.doc(`units/${unitId}/stats/questions`);
  const updateData: Record<string, admin.firestore.FieldValue> = {};

  correctQuestionIds.forEach((qId) => {
    updateData[`${qId}.correct`] = admin.firestore.FieldValue.increment(1);
    updateData[`${qId}.total`] = admin.firestore.FieldValue.increment(1);
  });
  wrongQuestionIds.forEach((qId) => {
    updateData[`${qId}.total`] = admin.firestore.FieldValue.increment(1);
  });

  await statsRef.set(updateData, { merge: true });

  return { success: true };
});

// ==========================================
// 3. initializeAdminClaims — 初回セットアップ用
// ==========================================
export const initializeAdminClaims = functions.region("us-central1").https.onRequest(async (req, res) => {
  // セキュリティ: Authorization ヘッダーで簡易認証
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.INIT_SECRET || "math-app-init-2026"}`) {
    res.status(403).send("Forbidden");
    return;
  }

  const adminEmails = [
    "kazuki2kr@gmail.com",
    "ichikawa.kazuki@shibaurafzk.com",
  ];

  const results: string[] = [];

  for (const email of adminEmails) {
    try {
      const user = await auth.getUserByEmail(email);
      await auth.setCustomUserClaims(user.uid, { admin: true });
      results.push(`✅ ${email} に admin Claim を設定しました。`);
    } catch (error: any) {
      results.push(`❌ ${email}: ${error.message}`);
    }
  }

  res.status(200).send(results.join("\n"));
});

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
