import { createHash } from 'crypto';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import {
  normalizePushNotificationPayload,
  type PushNotificationPayload,
} from './pushNotificationPayload';

const PUSH_SUBSCRIPTIONS_COLLECTION = 'push_subscriptions';
const NOTIFICATION_CAMPAIGNS_COLLECTION = 'notification_campaigns';
const MAX_MULTICAST_TOKENS = 500;
const MAX_SUBSCRIPTIONS_PER_USER = 5;
const MAX_ADMIN_HISTORY_ITEMS = 20;
const MAX_INBOX_ITEMS = 50;
const MAX_INBOX_CANDIDATES = 200;
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

function clampString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function assertAuthenticated(context: functions.https.CallableContext) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', '認証が必要です。');
  }
}

function assertAppAccess(context: functions.https.CallableContext) {
  assertAuthenticated(context);
  const token = context.auth!.token || {};
  const email = typeof token.email === 'string' ? token.email.trim().toLowerCase() : '';
  const allowed = token.admin === true || token.appAccess === true || email.endsWith('@shibaurafzk.com');
  if (!allowed) {
    throw new functions.https.HttpsError('permission-denied', 'このサービスの対象外アカウントです。');
  }
}

function assertAdmin(context: functions.https.CallableContext) {
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError('permission-denied', '管理者のみが通知を管理できます。');
  }
}

function isValidFcmToken(token: string) {
  return token.length >= 20 && token.length <= 4096 && !/\s/.test(token);
}

function subscriptionIdForToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function canReadNotificationCampaign(
  campaign: Record<string, unknown>,
  uid: string,
) {
  return campaign.deletedAt == null && (
    campaign.target === 'all'
    || (campaign.target === 'self' && campaign.sentByUid === uid)
  );
}

export function normalizeNotificationCampaignId(value: unknown) {
  const campaignId = clampString(value, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(campaignId)) {
    throw new Error('削除対象のお知らせIDが不正です。');
  }
  return campaignId;
}

export function normalizeNotificationLink(value: unknown) {
  const link = clampString(value, 200);
  return link.startsWith('/') && !link.startsWith('//') ? link : '/notifications';
}

function normalizeCallablePushPayload(data: unknown): PushNotificationPayload {
  try {
    return normalizePushNotificationPayload(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : '通知内容が不正です。';
    throw new functions.https.HttpsError('invalid-argument', message);
  }
}

export const registerPushSubscription = functions.region('us-central1').https.onCall(async (data, context) => {
  assertAppAccess(context);
  const input = (data || {}) as Record<string, unknown>;
  const token = clampString(input.token, 4096);
  const userAgent = clampString(input.userAgent, 300);
  if (!isValidFcmToken(token)) {
    throw new functions.https.HttpsError('invalid-argument', '通知用の端末トークンが不正です。');
  }

  const subscriptionId = subscriptionIdForToken(token);
  const ref = admin.firestore().collection(PUSH_SUBSCRIPTIONS_COLLECTION).doc(subscriptionId);
  const existing = await ref.get();
  const now = admin.firestore.Timestamp.now();

  if (!existing.exists) {
    const userSubscriptions = await admin.firestore()
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .where('uid', '==', context.auth!.uid)
      .get();
    if (userSubscriptions.size >= MAX_SUBSCRIPTIONS_PER_USER) {
      const oldest = userSubscriptions.docs
        .sort((a, b) => Number(a.data().updatedAt?.toMillis?.() || 0) - Number(b.data().updatedAt?.toMillis?.() || 0))
        .slice(0, userSubscriptions.size - MAX_SUBSCRIPTIONS_PER_USER + 1);
      const cleanupBatch = admin.firestore().batch();
      oldest.forEach((doc) => cleanupBatch.delete(doc.ref));
      await cleanupBatch.commit();
    }
  }

  await ref.set({
    uid: context.auth!.uid,
    token,
    userAgent,
    updatedAt: now,
    lastSeenAt: now,
    createdAt: existing.exists ? existing.data()?.createdAt || now : now,
  });

  return { subscriptionId };
});

export const unregisterPushSubscription = functions.region('us-central1').https.onCall(async (data, context) => {
  assertAuthenticated(context);
  const input = (data || {}) as Record<string, unknown>;
  const subscriptionId = clampString(input.subscriptionId, 64);
  if (!/^[a-f0-9]{64}$/.test(subscriptionId)) {
    throw new functions.https.HttpsError('invalid-argument', '通知端末IDが不正です。');
  }

  const ref = admin.firestore().collection(PUSH_SUBSCRIPTIONS_COLLECTION).doc(subscriptionId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return { success: true };
  if (snapshot.data()?.uid !== context.auth!.uid) {
    throw new functions.https.HttpsError('permission-denied', 'この通知端末は解除できません。');
  }

  await ref.delete();
  return { success: true };
});

export const getPushNotificationOverview = functions.region('us-central1').https.onCall(async (_data, context) => {
  assertAdmin(context);
  const db = admin.firestore();
  const [subscriptions, campaigns] = await Promise.all([
    db.collection(PUSH_SUBSCRIPTIONS_COLLECTION).get(),
    db.collection(NOTIFICATION_CAMPAIGNS_COLLECTION).orderBy('sentAt', 'desc').limit(MAX_INBOX_CANDIDATES).get(),
  ]);

  return {
    subscriberCount: subscriptions.size,
    campaigns: campaigns.docs
      .filter((doc) => doc.data().deletedAt == null)
      .slice(0, MAX_ADMIN_HISTORY_ITEMS)
      .map((doc) => {
        const campaign = doc.data();
        return {
          id: doc.id,
          title: String(campaign.title || ''),
          body: String(campaign.body || ''),
          link: String(campaign.link || '/'),
          target: campaign.target === 'all' ? 'all' : 'self',
          recipientCount: Number(campaign.recipientCount || 0),
          successCount: Number(campaign.successCount || 0),
          failureCount: Number(campaign.failureCount || 0),
          sentAt: campaign.sentAt?.toDate?.()?.toISOString?.() || '',
          sentByEmail: String(campaign.sentByEmail || ''),
        };
      }),
  };
});

export const deleteNotificationCampaign = functions.region('us-central1').https.onCall(async (data, context) => {
  assertAdmin(context);
  let campaignId: string;
  try {
    campaignId = normalizeNotificationCampaignId((data || {}).campaignId);
  } catch (error) {
    const message = error instanceof Error ? error.message : '削除対象のお知らせIDが不正です。';
    throw new functions.https.HttpsError('invalid-argument', message);
  }

  const campaignRef = admin.firestore().collection(NOTIFICATION_CAMPAIGNS_COLLECTION).doc(campaignId);
  await admin.firestore().runTransaction(async (transaction) => {
    const campaign = await transaction.get(campaignRef);
    if (!campaign.exists) {
      throw new functions.https.HttpsError('not-found', '削除対象のお知らせが見つかりません。');
    }
    if (campaign.data()?.deletedAt != null) return;

    transaction.update(campaignRef, {
      deletedAt: admin.firestore.Timestamp.now(),
      deletedByUid: context.auth!.uid,
      deletedByEmail: String(context.auth!.token?.email || ''),
    });
  });

  return { success: true };
});

export const getUserNotificationInbox = functions.region('us-central1').https.onCall(async (_data, context) => {
  assertAppAccess(context);

  const campaigns = await admin.firestore()
    .collection(NOTIFICATION_CAMPAIGNS_COLLECTION)
    .orderBy('sentAt', 'desc')
    .limit(MAX_INBOX_CANDIDATES)
    .get();

  const notifications = campaigns.docs
    .filter((doc) => canReadNotificationCampaign(doc.data(), context.auth!.uid))
    .slice(0, MAX_INBOX_ITEMS)
    .map((doc) => {
      const campaign = doc.data();
      return {
        id: doc.id,
        title: clampString(campaign.title, 60) || 'Formixからのお知らせ',
        body: clampString(campaign.body, 240),
        link: normalizeNotificationLink(campaign.link),
        sentAt: campaign.sentAt?.toDate?.()?.toISOString?.() || '',
      };
    });

  return { notifications };
});

export const sendPushNotification = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {
    assertAdmin(context);
    const payload = normalizeCallablePushPayload(data);
    const db = admin.firestore();
    const campaignRef = db.collection(NOTIFICATION_CAMPAIGNS_COLLECTION).doc();

    const subscriptions = payload.target === 'self'
      ? await db.collection(PUSH_SUBSCRIPTIONS_COLLECTION).where('uid', '==', context.auth!.uid).get()
      : await db.collection(PUSH_SUBSCRIPTIONS_COLLECTION).get();

    const subscriptionDocs = subscriptions.docs.filter((doc) => typeof doc.data().token === 'string');
    if (subscriptionDocs.length === 0) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        payload.target === 'self'
          ? 'この管理者アカウントで通知を有効にした端末がありません。'
          : '通知を有効にしている端末がありません。',
      );
    }

    let successCount = 0;
    let failureCount = 0;
    const invalidSubscriptionRefs: FirebaseFirestore.DocumentReference[] = [];

    for (let offset = 0; offset < subscriptionDocs.length; offset += MAX_MULTICAST_TOKENS) {
      const batchDocs = subscriptionDocs.slice(offset, offset + MAX_MULTICAST_TOKENS);
      const response = await admin.messaging().sendEachForMulticast({
        tokens: batchDocs.map((doc) => String(doc.data().token)),
        data: {
          title: payload.title,
          body: payload.body,
          link: payload.link,
          campaignId: campaignRef.id,
        },
        webpush: {
          headers: {
            Urgency: 'normal',
            TTL: '86400',
          },
        },
      });

      successCount += response.successCount;
      failureCount += response.failureCount;
      response.responses.forEach((result, index) => {
        if (!result.success && result.error?.code && INVALID_TOKEN_CODES.has(result.error.code)) {
          invalidSubscriptionRefs.push(batchDocs[index].ref);
        }
      });
    }

    if (invalidSubscriptionRefs.length > 0) {
      for (let offset = 0; offset < invalidSubscriptionRefs.length; offset += MAX_MULTICAST_TOKENS) {
        const cleanupBatch = db.batch();
        invalidSubscriptionRefs
          .slice(offset, offset + MAX_MULTICAST_TOKENS)
          .forEach((ref) => cleanupBatch.delete(ref));
        await cleanupBatch.commit();
      }
    }

    await campaignRef.set({
      ...payload,
      recipientCount: subscriptionDocs.length,
      successCount,
      failureCount,
      invalidTokenCount: invalidSubscriptionRefs.length,
      sentByUid: context.auth!.uid,
      sentByEmail: String(context.auth!.token?.email || ''),
      sentAt: admin.firestore.Timestamp.now(),
    });

    return {
      campaignId: campaignRef.id,
      recipientCount: subscriptionDocs.length,
      successCount,
      failureCount,
      invalidTokenCount: invalidSubscriptionRefs.length,
    };
  });
