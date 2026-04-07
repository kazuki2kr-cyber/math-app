"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAdmins = exports.processDrillResult = exports.setAdminClaim = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
// ==========================================
// 1. setAdminClaim — 管理者権限の付与/剥奪
// ==========================================
exports.setAdminClaim = functions.region("us-central1").https.onCall(async (data, context) => {
    var _a, _b;
    // 呼び出し元が管理者であることを確認
    if (!((_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.admin)) {
        throw new functions.https.HttpsError("permission-denied", "管理者のみがこの操作を実行できます。");
    }
    const { email, isAdmin } = data;
    if (!email || typeof isAdmin !== "boolean") {
        throw new functions.https.HttpsError("invalid-argument", "email (string) と isAdmin (boolean) が必要です。");
    }
    try {
        const targetUser = await auth.getUserByEmail(email);
        await auth.setCustomUserClaims(targetUser.uid, {
            admin: isAdmin,
        });
        return { success: true, message: `${email} の管理者権限を ${isAdmin ? "付与" : "剥奪"} しました。` };
    }
    catch (error) {
        throw new functions.https.HttpsError("not-found", `ユーザー ${email} が見つかりません: ${error.message}`);
    }
});
// ==========================================
// 2. processDrillResult — 演習結果の統合処理
// ==========================================
exports.processDrillResult = functions.region("us-central1").https.onCall(async (data, context) => {
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "認証が必要です。");
    }
    const { unitId, unitTitle, score, time, correctQuestions, wrongQuestions, xpDetails } = data;
    console.log(`[processDrillResult] Started for unitId: ${unitId}, uid: ${context.auth.uid}`);
    console.log(`[processDrillResult] Data summary: score=${score}, time=${time}, correct=${correctQuestions === null || correctQuestions === void 0 ? void 0 : correctQuestions.length}, wrong=${wrongQuestions === null || wrongQuestions === void 0 ? void 0 : wrongQuestions.length}`);
    if (!unitId || score === undefined || time === undefined) {
        console.error("[processDrillResult] Missing required parameters", { unitId, score, time });
        throw new functions.https.HttpsError("invalid-argument", "必要なパラメータが不足しています。");
    }
    // 配列が未定義の場合のフォールバック
    const safeCorrectQuestions = Array.isArray(correctQuestions) ? correctQuestions : [];
    const safeWrongQuestions = Array.isArray(wrongQuestions) ? wrongQuestions : [];
    const uid = context.auth.uid;
    const userName = ((_a = context.auth.token) === null || _a === void 0 ? void 0 : _a.name) || ((_b = context.auth.token) === null || _b === void 0 ? void 0 : _b.email) || "名無し";
    const now = firestore_1.Timestamp.now();
    const dateStr = now.toDate().toISOString();
    // --- 1. 不審なアクティビティの検証 ---
    const suspiciousReasons = [];
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
            const lastDateStr = lastData === null || lastData === void 0 ? void 0 : lastData.date;
            if (lastDateStr) {
                const lastDateTime = new Date(lastDateStr).getTime();
                const diffSec = (now.toMillis() - lastDateTime) / 1000;
                if (diffSec < 30 && (safeCorrectQuestions.length + safeWrongQuestions.length) >= 10) {
                    suspiciousReasons.push(`異常に短い演習間隔: ${Math.round(diffSec)}秒`);
                }
            }
        }
        if (score > 100)
            suspiciousReasons.push(`スコア不正: ${score}`);
        if (suspiciousReasons.length > 0) {
            await db.collection("suspicious_activities").add({
                uid, userName, unitId, reasons: suspiciousReasons, timestamp: now,
                details: { score, time, correctCount: safeCorrectQuestions.length }
            });
        }
    }
    catch (e) {
        console.error("[processDrillResult] Validation error:", e);
        // バリデーションエラーで処理全体を止めない
    }
    try {
        // --- 2. トランザクションによるデータ更新 ---
        return await db.runTransaction(async (transaction) => {
            var _a, _b, _c;
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
                currentXp = (uData === null || uData === void 0 ? void 0 : uData.xp) || 0;
                currentIcon = (uData === null || uData === void 0 ? void 0 : uData.icon) || "📐";
            }
            // 2-1. XP / レベル計算
            const finalXpGain = (xpDetails === null || xpDetails === void 0 ? void 0 : xpDetails.finalXp) || 0;
            const newTotalXp = currentXp + finalXpGain;
            // フロントエンドのロジックと同期 (便宜上 here)
            const calculateLevel = (xp) => Math.floor(Math.sqrt(xp / 10)) + 1;
            const oldLevel = calculateLevel(currentXp);
            const newLevel = calculateLevel(newTotalXp);
            const isLevelUp = newLevel > oldLevel;
            // 2-2. スコア更新判定 (High Score)
            let isHighScore = false;
            if (scoreSnap.exists) {
                const sData = scoreSnap.data();
                if (score > (sData === null || sData === void 0 ? void 0 : sData.maxScore) || (score === (sData === null || sData === void 0 ? void 0 : sData.maxScore) && time < (sData === null || sData === void 0 ? void 0 : sData.bestTime))) {
                    isHighScore = true;
                }
            }
            else {
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
                    maxScore: isHighScore ? score : (scoreSnap.exists ? (_a = scoreSnap.data()) === null || _a === void 0 ? void 0 : _a.maxScore : score),
                    bestTime: isHighScore ? time : (scoreSnap.exists ? (_b = scoreSnap.data()) === null || _b === void 0 ? void 0 : _b.bestTime : time),
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
                    ...safeCorrectQuestions.map((q) => ({ qId: q.id, isCorrect: true })),
                    ...safeWrongQuestions.map((q) => ({ qId: q.id, isCorrect: false }))
                ]
            });
            // Stats (Aggregated)
            const statsUpdate = {};
            safeCorrectQuestions.forEach((q) => {
                statsUpdate[`${q.id}.correct`] = firestore_1.FieldValue.increment(1);
                statsUpdate[`${q.id}.total`] = firestore_1.FieldValue.increment(1);
            });
            safeWrongQuestions.forEach((q) => {
                statsUpdate[`${q.id}.total`] = firestore_1.FieldValue.increment(1);
            });
            transaction.set(statsRef, statsUpdate, { merge: true });
            // Wrong Answers List
            let currentWrongs = wrongSnap.exists ? (((_c = wrongSnap.data()) === null || _c === void 0 ? void 0 : _c.wrongQuestionIds) || []) : [];
            const newlyCorrectIds = safeCorrectQuestions.map((q) => q.id);
            const newlyWrongIds = safeWrongQuestions.map((q) => q.id);
            currentWrongs = currentWrongs.filter(id => !newlyCorrectIds.includes(id));
            newlyWrongIds.forEach(id => { if (!currentWrongs.includes(id))
                currentWrongs.push(id); });
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
    }
    catch (error) {
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
exports.listAdmins = functions.region("us-central1").https.onCall(async (data, context) => {
    var _a, _b, _c;
    if (!((_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.admin)) {
        throw new functions.https.HttpsError("permission-denied", "管理者のみがこの操作を実行できます。");
    }
    const admins = [];
    // Firebase Auth の全ユーザーを走査して admin Claim を持つユーザーを抽出
    let nextPageToken;
    do {
        const listResult = await auth.listUsers(1000, nextPageToken);
        for (const userRecord of listResult.users) {
            if (((_c = userRecord.customClaims) === null || _c === void 0 ? void 0 : _c.admin) === true) {
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
//# sourceMappingURL=index.js.map