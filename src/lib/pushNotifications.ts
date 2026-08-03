import app, { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';

const SUBSCRIPTION_ID_KEY = 'formix_push_subscription_id';
const PUSH_DISABLED_KEY = 'formix_push_disabled';
const PUSH_SYNCED_AT_KEY = 'formix_push_synced_at';
const PUSH_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FIREBASE_VAPID_KEY = 'BDAFYRU8NaiPvkTzxe9O9IHxiO5f0Y-Bxl7ZofoxeVArS8MEMtzFvCb49i2J9UnyGzl9P8iDcEfvlmx8OAzGLcQ';

function getFirebaseVapidKey() {
  return process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || DEFAULT_FIREBASE_VAPID_KEY;
}

export type PushSupport = {
  supported: boolean;
  configured: boolean;
};

export async function registerPwaServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
}

export async function getPushSupport(): Promise<PushSupport> {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator)
  ) {
    return { supported: false, configured: false };
  }

  const { isSupported } = await import('firebase/messaging');
  return {
    supported: await isSupported(),
    configured: Boolean(getFirebaseVapidKey()),
  };
}

async function obtainAndRegisterToken(registration: ServiceWorkerRegistration) {
  const vapidKey = getFirebaseVapidKey();
  if (!vapidKey) throw new Error('Firebase Web Push VAPID key is not configured.');

  const { getMessaging, getToken } = await import('firebase/messaging');
  const token = await getToken(getMessaging(app), {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error('通知用の端末トークンを取得できませんでした。');

  const registerPushSubscription = httpsCallable<
    { token: string; userAgent: string },
    { subscriptionId: string }
  >(functions, 'registerPushSubscription');
  const result = await registerPushSubscription({
    token,
    userAgent: navigator.userAgent.slice(0, 300),
  });

  localStorage.setItem(SUBSCRIPTION_ID_KEY, result.data.subscriptionId);
  localStorage.setItem(PUSH_SYNCED_AT_KEY, String(Date.now()));
  localStorage.removeItem(PUSH_DISABLED_KEY);
  return registration;
}

export async function enablePushNotifications() {
  const support = await getPushSupport();
  if (!support.supported) throw new Error('このブラウザはプッシュ通知に対応していません。');
  if (!support.configured) throw new Error('通知機能は現在準備中です。');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? '通知がブロックされています。ブラウザのサイト設定から許可してください。'
      : '通知の許可が完了しませんでした。');
  }

  const registration = await registerPwaServiceWorker();
  if (!registration) throw new Error('Service Workerを登録できませんでした。');
  await obtainAndRegisterToken(registration);

  await registration.showNotification('Formixの通知を有効にしました', {
    body: '新しいお知らせをこの端末で受け取れます。',
    icon: '/images/icon.webp',
    badge: '/images/icon.webp',
    tag: 'formix-push-enabled',
    data: { link: '/' },
  });
}

export async function syncPushSubscriptionIfNeeded() {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (localStorage.getItem(PUSH_DISABLED_KEY) === 'true') return;

  const lastSyncedAt = Number(localStorage.getItem(PUSH_SYNCED_AT_KEY) || 0);
  if (Date.now() - lastSyncedAt < PUSH_SYNC_INTERVAL_MS) return;

  const support = await getPushSupport();
  if (!support.supported || !support.configured) return;
  const registration = await registerPwaServiceWorker();
  if (registration) await obtainAndRegisterToken(registration);
}

export async function disablePushNotifications() {
  const subscriptionId = localStorage.getItem(SUBSCRIPTION_ID_KEY);
  if (subscriptionId) {
    const unregisterPushSubscription = httpsCallable<{ subscriptionId: string }, { success: boolean }>(
      functions,
      'unregisterPushSubscription',
    );
    await unregisterPushSubscription({ subscriptionId });
  }

  const { deleteToken, getMessaging } = await import('firebase/messaging');
  await deleteToken(getMessaging(app)).catch(() => false);
  localStorage.removeItem(SUBSCRIPTION_ID_KEY);
  localStorage.removeItem(PUSH_SYNCED_AT_KEY);
  localStorage.setItem(PUSH_DISABLED_KEY, 'true');
}

export function isPushDisabledOnThisDevice() {
  return typeof window !== 'undefined' && localStorage.getItem(PUSH_DISABLED_KEY) === 'true';
}

export async function listenForForegroundMessages(
  onNotification: (data: { title: string; body: string; link: string; campaignId: string }) => void,
) {
  const support = await getPushSupport();
  if (!support.supported || !support.configured) return () => undefined;

  const { getMessaging, onMessage } = await import('firebase/messaging');
  return onMessage(getMessaging(app), (payload) => {
    onNotification({
      title: payload.data?.title || 'Formix',
      body: payload.data?.body || '新しいお知らせがあります。',
      link: payload.data?.link || '/',
      campaignId: payload.data?.campaignId || '',
    });
  });
}
