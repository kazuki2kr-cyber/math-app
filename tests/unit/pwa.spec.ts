import manifest from '@/app/manifest';
import { GET as getMessagingServiceWorker } from '@/app/firebase-messaging-sw.js/route';
import { GET as getLegacyPwaIcon } from '@/app/pwa-icon/route';
import nextConfig from '../../next.config';
import { normalizePushNotificationPayload } from '../../functions/src/pushNotificationPayload';

describe('PWA configuration', () => {
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
});
