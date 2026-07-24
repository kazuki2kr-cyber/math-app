'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  Inbox,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { functions } from '@/lib/firebase';
import { usePwa } from '@/components/PwaProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  link: string;
  sentAt: string;
};

type NotificationInboxResponse = {
  notifications: NotificationItem[];
};

function formatSentAt(value: string) {
  if (!value) return '配信日時不明';
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function NotificationsPage() {
  const router = useRouter();
  const {
    notificationState,
    busy,
    error: notificationError,
    enableNotifications,
    disableNotifications,
    refreshNotifications,
  } = usePwa();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [inboxError, setInboxError] = useState('');

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setInboxError('');
    try {
      const getInbox = httpsCallable<Record<string, never>, NotificationInboxResponse>(
        functions,
        'getUserNotificationInbox',
      );
      const result = await getInbox({});
      setNotifications(result.data.notifications);
    } catch (loadError) {
      console.error('Failed to load notification inbox:', loadError);
      setInboxError('お知らせを読み込めませんでした。時間をおいてもう一度お試しください。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const notificationEnabled = notificationState === 'enabled';
  const notificationBlocked = notificationState === 'blocked';
  const notificationCanEnable = notificationState === 'default' || notificationState === 'disabled';

  return (
    <div className="min-h-screen bg-[#F8FAEB]">
      <header className="sticky top-0 z-40 border-b border-primary/10 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => router.push('/')}
              aria-label="ダッシュボードへ戻る"
            >
              <ArrowLeft />
            </Button>
            <div>
              <h1 className="text-lg font-black text-gray-900 md:text-xl">お知らせ</h1>
              <p className="text-xs text-muted-foreground">Formixから届いた情報を確認できます</p>
            </div>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
            notificationEnabled
              ? 'bg-emerald-50 text-emerald-700'
              : notificationBlocked
                ? 'bg-red-50 text-red-700'
                : 'bg-gray-100 text-gray-600'
          }`}>
            {notificationEnabled ? <BellRing className="h-3.5 w-3.5" /> : notificationBlocked ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
            {notificationEnabled ? '通知ON' : notificationBlocked ? 'ブロック中' : '通知OFF'}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 md:py-8">
        <Card className={notificationBlocked ? 'border-red-200 bg-red-50/60' : 'border-primary/10'}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-5 w-5" />
              この端末の通知設定
            </CardTitle>
            <CardDescription>
              お知らせ一覧は通知設定にかかわらず利用できます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {notificationEnabled && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-2 text-sm leading-6 text-emerald-800">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0" />
                  アプリを閉じているときも、この端末で大切なお知らせを受け取れます。
                </p>
                <Button type="button" variant="outline" size="sm" onClick={disableNotifications} disabled={busy}>
                  この端末の通知を停止
                </Button>
              </div>
            )}

            {notificationCanEnable && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-6 text-gray-700">
                  通知を有効にすると、アプリを閉じているときも新しい課題や大切なお知らせを受け取れます。
                </p>
                <Button type="button" onClick={enableNotifications} disabled={busy}>
                  <Bell className="mr-1 h-4 w-4" />
                  通知を有効にする
                </Button>
              </div>
            )}

            {notificationBlocked && (
              <div className="space-y-4">
                <div>
                  <p className="font-bold text-red-900">ブラウザのサイト設定から通知を許可してください</p>
                  <p className="mt-1 text-sm leading-6 text-red-800/80">
                    一度「許可しない」を選ぶと、Formixから許可画面をもう一度表示できません。次の手順で変更できます。
                  </p>
                </div>
                <ol className="space-y-2 rounded-xl border border-red-200 bg-white/80 p-4 text-sm leading-6 text-gray-700">
                  <li><span className="mr-2 font-black text-red-700">1.</span>FormixをChromeまたはEdgeのブラウザで開きます。</li>
                  <li><span className="mr-2 font-black text-red-700">2.</span>アドレスバー左側のサイト情報アイコンを押し、「サイトの設定」を開きます。</li>
                  <li><span className="mr-2 font-black text-red-700">3.</span>「通知」を「許可」に変更して、Formixへ戻ります。</li>
                </ol>
                <Button type="button" variant="outline" onClick={refreshNotifications} disabled={busy}>
                  <RefreshCw className={`mr-1 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                  設定を確認する
                </Button>
              </div>
            )}

            {notificationState === 'unconfigured' && (
              <p className="text-sm text-amber-700">通知機能は現在準備中です。お知らせ一覧は引き続き利用できます。</p>
            )}
            {notificationState === 'unsupported' && (
              <p className="text-sm text-gray-600">このブラウザではプッシュ通知を利用できません。お知らせはこの画面で確認してください。</p>
            )}
            {notificationError && !notificationBlocked && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{notificationError}</p>
            )}
          </CardContent>
        </Card>

        <section aria-labelledby="notification-list-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 id="notification-list-title" className="font-black text-gray-900">届いたお知らせ</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">新しいものから最大50件表示します</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={loadNotifications} disabled={loading}>
              <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              更新
            </Button>
          </div>

          {inboxError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {inboxError}
            </div>
          )}

          {loading && notifications.length === 0 ? (
            <div className="flex items-center justify-center rounded-2xl border border-gray-100 bg-white py-16 shadow-sm">
              <RefreshCw className="h-6 w-6 animate-spin text-primary" aria-label="お知らせを読み込み中" />
            </div>
          ) : notifications.length === 0 && !inboxError ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white/70 px-6 py-14 text-center">
              <Inbox className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 font-bold text-gray-700">お知らせはまだありません</p>
              <p className="mt-1 text-sm text-gray-500">新しいお知らせが届くと、ここに表示されます。</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <article key={notification.id} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-xl bg-primary/10 p-2.5 text-primary">
                      <Bell className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <time className="text-[11px] font-semibold text-muted-foreground">
                        {formatSentAt(notification.sentAt)}
                      </time>
                      <h3 className="mt-1 font-black leading-6 text-gray-900">{notification.title}</h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600">{notification.body}</p>
                      {notification.link !== '/notifications' && (
                        <a
                          href={notification.link}
                          className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline"
                        >
                          関連ページを開く
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
