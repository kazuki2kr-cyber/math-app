import { readFileSync } from 'fs';
import { resolve } from 'path';
import manifest from '@/app/manifest';
import { GET as getMessagingServiceWorker } from '@/app/firebase-messaging-sw.js/route';
import { GET as getLegacyPwaIcon } from '@/app/pwa-icon/route';
import { waitForServiceWorkerActivation } from '@/lib/pwaServiceWorker';
import nextConfig from '../../next.config';
import { normalizePushNotificationPayload } from '../../functions/src/pushNotificationPayload';
import {
  canReadNotificationCampaign,
  canReadNotificationSummaryItem,
  normalizeNotificationCampaignId,
  normalizeNotificationLink,
} from '../../functions/src/pushNotifications';
import {
  addNotificationId,
  getUnreadNotificationIds,
  markNotificationIdsRead,
  normalizeNotificationIds,
} from '@/lib/notificationReadState';

describe('PWA configuration', () => {
  it('waits for a newly registered service worker to become active', async () => {
    const worker = new EventTarget() as ServiceWorker;
    Object.defineProperty(worker, 'state', { value: 'installing', writable: true });
    const registration = {
      active: null,
      installing: worker,
      waiting: null,
    } as unknown as ServiceWorkerRegistration;

    const activation = waitForServiceWorkerActivation(registration, 1_000);
    Object.defineProperty(worker, 'state', { value: 'activated', writable: true });
    worker.dispatchEvent(new Event('statechange'));

    await expect(activation).resolves.toBe(registration);
  });

  it('rejects a redundant service worker instead of subscribing too early', async () => {
    const worker = new EventTarget() as ServiceWorker;
    Object.defineProperty(worker, 'state', { value: 'installing', writable: true });
    const registration = {
      active: null,
      installing: worker,
      waiting: null,
    } as unknown as ServiceWorkerRegistration;

    const activation = waitForServiceWorkerActivation(registration, 1_000);
    Object.defineProperty(worker, 'state', { value: 'redundant', writable: true });
    worker.dispatchEvent(new Event('statechange'));

    await expect(activation).rejects.toThrow('Service Workerの有効化に失敗しました。');
  });

  it('uses standalone display without declaring offline behavior', () => {
    const value = manifest();
    expect(value.name).toBe('Formix');
    expect(value.display).toBe('standalone');
    expect(value.start_url).toBe('/');
    expect(value.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/images/pwa-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }),
      expect.objectContaining({ src: '/images/pwa-icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }),
    ]));
  });

  it('serves a notification-only service worker with caching disabled', async () => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-api-key';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'test-project';
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '123456';
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'test-app-id';

    const response = getMessagingServiceWorker();
    const source = await response.text();

    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(source).toContain('onBackgroundMessage');
    expect(source).toContain('notificationclick');
    expect(source).toContain('/notifications');
    expect(source).toContain('setAppBadge');
    expect(source).toContain('FORMIX_NOTIFICATION_RECEIVED');
    expect(source).not.toMatch(/addEventListener\(["']fetch["']/);
    expect(source).not.toContain('caches.open');
    expect(source).not.toContain('respondWith');
  });

  it('recovers legacy PWA icon requests without leaving users on a 404 page', () => {
    const documentResponse = getLegacyPwaIcon(new Request('https://formix.test/pwa-icon', {
      headers: {
        accept: 'text/html',
        'sec-fetch-dest': 'document',
      },
    }));
    const imageResponse = getLegacyPwaIcon(new Request('https://formix.test/pwa-icon', {
      headers: {
        accept: 'image/avif,image/webp,*/*',
        'sec-fetch-dest': 'image',
      },
    }));

    expect(documentResponse.status).toBe(307);
    expect(documentResponse.headers.get('location')).toBe('https://formix.test/');
    expect(imageResponse.status).toBe(307);
    expect(imageResponse.headers.get('location')).toBe('https://formix.test/images/pwa-icon.png');
  });

  it('redirects legacy kanji links to the current yamato routes', async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: '/kanji',
        destination: '/yamato',
        permanent: true,
      }),
      expect.objectContaining({
        source: '/kanji/:path*',
        destination: '/yamato/:path*',
        permanent: true,
      }),
    ]));
  });
});

describe('push notification payload validation', () => {
  it('accepts an in-app relative link and explicit all target', () => {
    expect(normalizePushNotificationPayload({
      title: ' お知らせ ',
      body: ' 新しい課題があります。 ',
      link: '/drill/example',
      target: 'all',
    })).toEqual({
      title: 'お知らせ',
      body: '新しい課題があります。',
      link: '/drill/example',
      target: 'all',
    });
  });

  it('rejects external and protocol-relative links', () => {
    expect(() => normalizePushNotificationPayload({
      title: 'お知らせ',
      body: '本文',
      link: 'https://example.com',
      target: 'all',
    })).toThrow('リンクはFormix内の相対パスで指定してください。');

    expect(() => normalizePushNotificationPayload({
      title: 'お知らせ',
      body: '本文',
      link: '//example.com',
      target: 'all',
    })).toThrow('リンクはFormix内の相対パスで指定してください。');
  });

  it('fails safely to self target for an unknown target value', () => {
    expect(normalizePushNotificationPayload({
      title: 'テスト',
      body: '本文',
      link: '/',
      target: 'unexpected',
    }).target).toBe('self');
  });

  it('defaults notification links to the in-app notification center', () => {
    expect(normalizePushNotificationPayload({
      title: 'テスト',
      body: '本文',
      target: 'all',
    }).link).toBe('/notifications');
  });
});

describe('notification inbox access', () => {
  it('shows global campaigns and only the signed-in user self campaigns', () => {
    expect(canReadNotificationCampaign({ target: 'all' }, 'user-1')).toBe(true);
    expect(canReadNotificationCampaign({ target: 'self', sentByUid: 'user-1' }, 'user-1')).toBe(true);
    expect(canReadNotificationCampaign({ target: 'self', sentByUid: 'user-2' }, 'user-1')).toBe(false);
    expect(canReadNotificationCampaign({ target: 'all', deletedAt: new Date() }, 'user-1')).toBe(false);
  });

  it('filters summary entries by the same audience rules', () => {
    expect(canReadNotificationSummaryItem({ target: 'all', sentByUid: 'admin-1' }, 'user-1')).toBe(true);
    expect(canReadNotificationSummaryItem({ target: 'self', sentByUid: 'user-1' }, 'user-1')).toBe(true);
    expect(canReadNotificationSummaryItem({ target: 'self', sentByUid: 'admin-1' }, 'user-1')).toBe(false);
  });

  it('validates campaign IDs before deletion', () => {
    expect(normalizeNotificationCampaignId('campaign_123')).toBe('campaign_123');
    expect(() => normalizeNotificationCampaignId('../campaign')).toThrow('削除対象のお知らせIDが不正です。');
    expect(() => normalizeNotificationCampaignId('')).toThrow('削除対象のお知らせIDが不正です。');
  });

  it('fails closed for unsafe or missing campaign links', () => {
    expect(normalizeNotificationLink('/drill/example')).toBe('/drill/example');
    expect(normalizeNotificationLink('https://example.com')).toBe('/notifications');
    expect(normalizeNotificationLink('//example.com')).toBe('/notifications');
    expect(normalizeNotificationLink(undefined)).toBe('/notifications');
  });
});

describe('local notification read state', () => {
  it('tracks unread notification IDs without per-user database writes', () => {
    const campaignIds = normalizeNotificationIds(['new-2', 'new-1', 'new-1']);
    const readIds = markNotificationIdsRead([], ['new-1']);

    expect(campaignIds).toEqual(['new-2', 'new-1']);
    expect(readIds).toEqual(['new-1']);
    expect(getUnreadNotificationIds(campaignIds, readIds)).toEqual(['new-2']);
    expect(addNotificationId(campaignIds, 'new-3')).toEqual(['new-3', 'new-2', 'new-1']);
  });

  it('drops malformed IDs from local storage data', () => {
    expect(normalizeNotificationIds(['valid_id', '../invalid', 123, 'valid_id'])).toEqual(['valid_id']);
  });
});

describe('notification link UI', () => {
  it('keeps notification destinations on the inbox without exposing link controls', () => {
    const notificationPage = readFileSync(resolve(process.cwd(), 'src/app/notifications/page.tsx'), 'utf8');
    const adminTab = readFileSync(resolve(process.cwd(), 'src/app/admin/components/NotificationsTab.tsx'), 'utf8');

    expect(notificationPage).not.toContain('関連ページを開く');
    expect(adminTab).not.toContain('開くページ');
    expect(adminTab).not.toContain('notification-link');
    expect(adminTab).toContain("link: '/notifications'");
    expect(adminTab).toContain("'deleteNotificationCampaign'");
    expect(adminTab).toContain('配信済みのプッシュ通知は取り消せません');
    expect(notificationPage).toContain('すべて既読');
    expect(notificationPage).toContain('既読にする');
  });
});
