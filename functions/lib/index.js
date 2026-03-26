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
exports.listAdmins = exports.initializeAdminClaims = exports.updateQuestionStats = exports.setAdminClaim = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
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
// 2. updateQuestionStats — 演習結果のstats更新
// ==========================================
exports.updateQuestionStats = functions.region("us-central1").https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "認証が必要です。");
    }
    const { unitId, correctQuestionIds, wrongQuestionIds } = data;
    if (!unitId || !Array.isArray(correctQuestionIds) || !Array.isArray(wrongQuestionIds)) {
        throw new functions.https.HttpsError("invalid-argument", "unitId, correctQuestionIds, wrongQuestionIds が必要です。");
    }
    const statsRef = db.doc(`units/${unitId}/stats/questions`);
    const updateData = {};
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
exports.initializeAdminClaims = functions.region("us-central1").https.onRequest(async (req, res) => {
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
    const results = [];
    for (const email of adminEmails) {
        try {
            const user = await auth.getUserByEmail(email);
            await auth.setCustomUserClaims(user.uid, { admin: true });
            results.push(`✅ ${email} に admin Claim を設定しました。`);
        }
        catch (error) {
            results.push(`❌ ${email}: ${error.message}`);
        }
    }
    res.status(200).send(results.join("\n"));
});
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