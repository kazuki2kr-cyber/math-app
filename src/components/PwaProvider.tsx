'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';
import { Bell, BellOff, BellRing, Download, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { functions } from '@/lib/firebase';
import {
  addNotificationId,
  getUnreadNotificationIds,
  markNotificationIdsRead,
  normalizeNotificationIds,
} from '@/lib/notificationReadState';
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushSupport,
  isPushDisabledOnThisDevice,
  listenForForegroundMessages,
  registerPwaServiceWorker,
  syncPushSubscriptionIfNeeded,
} from '@/lib/pushNotifications';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type NotificationState = 'checking' | 'unsupported' | 'unconfigured' | 'default' | 'enabled' | 'disabled' | 'blocked';

type PwaContextValue = {
  notificationState: NotificationState;
  unreadNotificationCount: number;
  busy: boolean;
  error: string;
  canInstall: boolean;
  isInstalled: boolean;
  installApp: () => Promise<void>;
  enableNotifications: () => Promise<void>;
  disableNotifications: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  refreshNotificationSummary: () => Promise<void>;
  isNotificationRead: (notificationId: string) => boolean;
  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: () => void;
  syncNotificationCampaigns: (notificationIds: string[]) => void;
};

const DISMISSED_UNTIL_KEY = 'formix_pwa_prompt_dismissed_until';
const NOTIFICATION_CAMPAIGN_IDS_KEY_PREFIX = 'formix_notification_campaign_ids:';
const NOTIFICATION_READ_IDS_KEY_PREFIX = 'formix_notification_read_ids:';
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const PwaContext = createContext<PwaContextValue | null>(null);

function detectStandalone() {
  if (typeof window === 'undefined') return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}

function detectIos() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function readStoredNotificationIds(key: string) {
  try {
    return normalizeNotificationIds(JSON.parse(localStorage.getItem(key) || '[]'));
  } catch {
    return [];
  }
}

function writeStoredNotificationIds(key: string, ids: string[]) {
  localStorage.setItem(key, JSON.stringify(normalizeNotificationIds(ids)));
}

type NotificationSummaryResponse = {
  notifications: Array<{ id: string; sentAt: string }>;
};

type NavigatorWithBadging = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [notificationState, setNotificationState] = useState<NotificationState>('checking');
  const [notificationCampaignIds, setNotificationCampaignIds] = useState<string[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(true);

  const syncNotificationCampaigns = useCallback((notificationIds: string[]) => {
    const normalizedIds = normalizeNotificationIds(notificationIds);
    setNotificationCampaignIds(normalizedIds);
    if (user?.uid) {
      writeStoredNotificationIds(`${NOTIFICATION_CAMPAIGN_IDS_KEY_PREFIX}${user.uid}`, normalizedIds);
    }
  }, [user?.uid]);

  const registerUnreadNotification = useCallback((notificationId: string) => {
    if (!notificationId || !user?.uid) return;
    setNotificationCampaignIds((currentIds) => {
      const nextIds = addNotificationId(currentIds, notificationId);
      writeStoredNotificationIds(`${NOTIFICATION_CAMPAIGN_IDS_KEY_PREFIX}${user.uid}`, nextIds);
      return nextIds;
    });
  }, [user?.uid]);

  const refreshNotificationSummary = useCallback(async () => {
    if (!user?.uid) return;
    const getSummary = httpsCallable<Record<string, never>, NotificationSummaryResponse>(
      functions,
      'getUserNotificationSummary',
    );
    const result = await getSummary({});
    syncNotificationCampaigns(result.data.notifications.map((notification) => notification.id));
  }, [syncNotificationCampaigns, user?.uid]);

  const markNotificationRead = useCallback((notificationId: string) => {
    if (!user?.uid) return;
    setReadNotificationIds((currentIds) => {
      const nextIds = markNotificationIdsRead(currentIds, [notificationId]);
      writeStoredNotificationIds(`${NOTIFICATION_READ_IDS_KEY_PREFIX}${user.uid}`, nextIds);
      return nextIds;
    });
  }, [user?.uid]);

  const markAllNotificationsRead = useCallback(() => {
    if (!user?.uid) return;
    setReadNotificationIds((currentIds) => {
      const nextIds = markNotificationIdsRead(currentIds, notificationCampaignIds);
      writeStoredNotificationIds(`${NOTIFICATION_READ_IDS_KEY_PREFIX}${user.uid}`, nextIds);
      return nextIds;
    });
  }, [notificationCampaignIds, user?.uid]);

  const readNotificationIdSet = useMemo(() => new Set(readNotificationIds), [readNotificationIds]);
  const isNotificationRead = useCallback(
    (notificationId: string) => readNotificationIdSet.has(notificationId),
    [readNotificationIdSet],
  );
  const unreadNotificationCount = useMemo(
    () => getUnreadNotificationIds(notificationCampaignIds, readNotificationIds).length,
    [notificationCampaignIds, readNotificationIds],
  );

  const refreshNotificationState = useCallback(async () => {
    const support = await getPushSupport();
    if (!support.supported) {
      setNotificationState('unsupported');
      return;
    }
    if (!support.configured) {
      setNotificationState('unconfigured');
      return;
    }
    if (Notification.permission === 'denied') {
      setNotificationState('blocked');
      return;
    }
    if (Notification.permission === 'granted') {
      setNotificationState(isPushDisabledOnThisDevice() ? 'disabled' : 'enabled');
      return;
    }
    setNotificationState('default');
  }, []);

  const refreshNotifications = useCallback(async () => {
    if (
      typeof window !== 'undefined'
      && 'Notification' in window
      && Notification.permission === 'granted'
    ) {
      await syncPushSubscriptionIfNeeded().catch((syncError) => {
        console.warn('Push subscription refresh failed:', syncError);
      });
    }
    await refreshNotificationState();
  }, [refreshNotificationState]);

  useEffect(() => {
    setIsInstalled(detectStandalone());
    const dismissedUntil = Number(localStorage.getItem(DISMISSED_UNTIL_KEY) || 0);
    setDismissed(dismissedUntil > Date.now());

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
      setDismissed(false);
    };

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    registerPwaServiceWorker().catch((registrationError) => {
      console.warn('PWA Service Worker registration failed:', registrationError);
    });
    refreshNotifications().catch(() => setNotificationState('unsupported'));

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshNotifications().catch(() => undefined);
      }
    };
    const handleFocus = () => {
      refreshNotifications().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refreshNotifications]);

  useEffect(() => {
    if (!user?.uid) {
      setNotificationCampaignIds([]);
      setReadNotificationIds([]);
      return;
    }

    setNotificationCampaignIds(readStoredNotificationIds(
      `${NOTIFICATION_CAMPAIGN_IDS_KEY_PREFIX}${user.uid}`,
    ));
    setReadNotificationIds(readStoredNotificationIds(
      `${NOTIFICATION_READ_IDS_KEY_PREFIX}${user.uid}`,
    ));
    refreshNotificationSummary().catch((summaryError) => {
      console.warn('Notification summary refresh failed:', summaryError);
    });
  }, [refreshNotificationSummary, user?.uid]);

  useEffect(() => {
    if (!user) return;
    syncPushSubscriptionIfNeeded().catch((syncError) => {
      console.warn('Push subscription sync failed:', syncError);
    });
  }, [user]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: () => void = () => {};

    listenForForegroundMessages(async ({ title, body, link, campaignId }) => {
      registerUnreadNotification(campaignId);
      const registration = await registerPwaServiceWorker();
      await registration?.showNotification(title, {
        body,
        icon: '/images/icon.webp',
        badge: '/images/icon.webp',
        tag: 'formix-foreground-notification',
        data: { link },
      });
    }).then((listener) => {
      if (disposed) listener();
      else unsubscribe = listener;
    }).catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [registerUnreadNotification]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'FORMIX_NOTIFICATION_RECEIVED') {
        registerUnreadNotification(String(event.data.campaignId || ''));
      }
    };
    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
  }, [registerUnreadNotification]);

  useEffect(() => {
    const badgingNavigator = navigator as NavigatorWithBadging;
    if (unreadNotificationCount > 0 && user) {
      badgingNavigator.setAppBadge?.(unreadNotificationCount).catch(() => undefined);
    } else {
      badgingNavigator.clearAppBadge?.().catch(() => undefined);
    }
  }, [unreadNotificationCount, user]);

  const installApp = useCallback(async () => {
    if (!installPrompt) return;
    setBusy(true);
    setError('');
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setInstallPrompt(null);
    } finally {
      setBusy(false);
    }
  }, [installPrompt]);

  const enableNotifications = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await enablePushNotifications();
      setNotificationState('enabled');
      setDismissed(true);
      localStorage.setItem(DISMISSED_UNTIL_KEY, String(Date.now() + DISMISS_DURATION_MS));
    } catch (notificationError) {
      const message = notificationError instanceof Error ? notificationError.message : '通知を有効にできませんでした。';
      setError(message);
      setDismissed(false);
      localStorage.removeItem(DISMISSED_UNTIL_KEY);
      await refreshNotificationState();
    } finally {
      setBusy(false);
    }
  }, [refreshNotificationState]);

  const disableNotifications = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await disablePushNotifications();
      setNotificationState('disabled');
      setDismissed(true);
      localStorage.setItem(DISMISSED_UNTIL_KEY, String(Date.now() + DISMISS_DURATION_MS));
    } catch (notificationError) {
      setError(notificationError instanceof Error ? notificationError.message : '通知を停止できませんでした。');
    } finally {
      setBusy(false);
    }
  }, []);

  const contextValue = useMemo<PwaContextValue>(() => ({
    notificationState,
    unreadNotificationCount,
    busy,
    error,
    canInstall: Boolean(installPrompt),
    isInstalled,
    installApp,
    enableNotifications,
    disableNotifications,
    refreshNotifications,
    refreshNotificationSummary,
    isNotificationRead,
    markNotificationRead,
    markAllNotificationsRead,
    syncNotificationCampaigns,
  }), [
    notificationState,
    unreadNotificationCount,
    busy,
    error,
    installPrompt,
    isInstalled,
    installApp,
    enableNotifications,
    disableNotifications,
    refreshNotifications,
    refreshNotificationSummary,
    isNotificationRead,
    markNotificationRead,
    markAllNotificationsRead,
    syncNotificationCampaigns,
  ]);

  const canEnableNotifications = notificationState === 'default';
  const showIosInstallGuide = detectIos() && !isInstalled && !installPrompt;
  const showPrompt = Boolean(
    user &&
    pathname === '/' &&
    !dismissed &&
    (installPrompt || canEnableNotifications || showIosInstallGuide || Boolean(error)),
  );

  const dismissPrompt = () => {
    localStorage.setItem(DISMISSED_UNTIL_KEY, String(Date.now() + DISMISS_DURATION_MS));
    setDismissed(true);
  };

  return (
    <PwaContext.Provider value={contextValue}>
      {children}
      {showPrompt && (
        <aside className="fixed bottom-4 left-4 right-4 z-[70] mx-auto max-w-xl rounded-lg border border-emerald-900/15 bg-white p-4 shadow-2xl" aria-label="Formixアプリ設定">
          <button
            type="button"
            onClick={dismissPrompt}
            className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
            aria-label="あとで設定する"
            title="あとで設定する"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="pr-8">
            <p className="font-bold text-gray-900">Formixをもっと使いやすく</p>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              {showIosInstallGuide
                ? 'Safariの共有メニューから「ホーム画面に追加」すると、アプリ表示と通知を利用できます。'
                : 'ホーム画面からすぐ開けます。通知を有効にすると、新しい課題や大切なお知らせを受け取れます。'}
            </p>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {installPrompt && (
                <Button type="button" variant="outline" size="sm" onClick={installApp} disabled={busy}>
                  <Download className="mr-2 h-4 w-4" /> ホーム画面に追加
                </Button>
              )}
              {canEnableNotifications && !showIosInstallGuide && (
                <Button type="button" size="sm" onClick={enableNotifications} disabled={busy}>
                  <Bell className="mr-2 h-4 w-4" /> 通知を有効にする
                </Button>
              )}
            </div>
          </div>
        </aside>
      )}
    </PwaContext.Provider>
  );
}

export function usePwa() {
  const context = useContext(PwaContext);
  if (!context) throw new Error('usePwa must be used inside PwaProvider.');
  return context;
}

export function PwaHeaderActions() {
  const {
    notificationState,
    unreadNotificationCount,
    busy,
    canInstall,
    installApp,
  } = usePwa();
  const router = useRouter();
  const showNotificationButton = notificationState !== 'checking';

  return (
    <div className="flex items-center gap-1">
      {canInstall && (
        <Button type="button" variant="ghost" size="sm" onClick={installApp} disabled={busy} title="ホーム画面に追加">
          <Download className="h-4 w-4" />
          <span className="ml-2 hidden lg:inline">アプリ</span>
        </Button>
      )}
      {showNotificationButton && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push('/notifications')}
          disabled={busy}
          title={notificationState === 'blocked' ? 'お知らせと通知ブロックの解除方法' : 'お知らせを開く'}
          aria-label={unreadNotificationCount > 0
            ? `お知らせを開く、未読${unreadNotificationCount}件`
            : 'お知らせと通知設定を開く'}
          className={`relative ${notificationState === 'enabled' ? 'text-emerald-700' : 'text-muted-foreground'}`}
        >
          <span className="relative inline-flex">
            {notificationState === 'enabled' ? <BellRing className="h-4 w-4" /> : notificationState === 'blocked' ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            {unreadNotificationCount > 0 && (
              <span className="absolute -right-2.5 -top-2.5 inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-4 text-white shadow-sm ring-2 ring-white">
                {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
              </span>
            )}
          </span>
          <span className="ml-2 hidden lg:inline">お知らせ</span>
        </Button>
      )}
    </div>
  );
}
