'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellRing, RefreshCw, Send, Smartphone, Users } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { usePwa } from '@/components/PwaProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type NotificationTarget = 'self' | 'all';

type Campaign = {
  id: string;
  title: string;
  body: string;
  link: string;
  target: NotificationTarget;
  recipientCount: number;
  successCount: number;
  failureCount: number;
  sentAt: string;
  sentByEmail: string;
};

type Overview = {
  subscriberCount: number;
  campaigns: Campaign[];
};

function formatSentAt(value: string) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function NotificationsTab() {
  const { notificationState, busy: deviceBusy, enableNotifications } = usePwa();
  const [title, setTitle] = useState('Formixからのお知らせ');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('/');
  const [target, setTarget] = useState<NotificationTarget>('self');
  const [overview, setOverview] = useState<Overview>({ subscriberCount: 0, campaigns: [] });
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const getOverview = httpsCallable<Record<string, never>, Overview>(functions, 'getPushNotificationOverview');
      const result = await getOverview({});
      setOverview(result.data);
    } catch (overviewError) {
      setError(overviewError instanceof Error ? overviewError.message : '通知情報を取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleSend = async () => {
    setMessage('');
    setError('');
    if (!title.trim() || !body.trim()) {
      setError('タイトルと本文を入力してください。');
      return;
    }
    if (target === 'all' && !window.confirm(`通知を許可している${overview.subscriberCount}端末へ一斉送信します。よろしいですか？`)) {
      return;
    }

    setSending(true);
    try {
      const sendNotification = httpsCallable<
        { title: string; body: string; link: string; target: NotificationTarget },
        { recipientCount: number; successCount: number; failureCount: number }
      >(functions, 'sendPushNotification');
      const result = await sendNotification({
        title: title.trim(),
        body: body.trim(),
        link: link.trim() || '/',
        target,
      });
      setMessage(`${result.data.recipientCount}端末中、${result.data.successCount}端末への送信を受け付けました。`);
      if (result.data.failureCount > 0) {
        setMessage((current) => `${current} 失敗: ${result.data.failureCount}端末`);
      }
      await loadOverview();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '通知を送信できませんでした。');
    } finally {
      setSending(false);
    }
  };

  const deviceRegistered = notificationState === 'enabled';
  const deviceCanRegister = notificationState === 'default' || notificationState === 'disabled';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Smartphone className="h-5 w-5" /> この端末
          </CardTitle>
          <CardDescription>自分へのテスト送信を受け取る管理者端末を登録します。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {deviceRegistered ? (
            <span className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700">
              <BellRing className="h-4 w-4" /> 通知を受け取れる状態です
            </span>
          ) : deviceCanRegister ? (
            <Button type="button" variant="outline" onClick={enableNotifications} disabled={deviceBusy}>
              <Bell className="mr-2 h-4 w-4" /> この端末で通知を有効にする
            </Button>
          ) : notificationState === 'unconfigured' ? (
            <p className="text-sm text-amber-700">VAPIDキーを設定すると通知端末を登録できます。</p>
          ) : notificationState === 'blocked' ? (
            <p className="text-sm text-red-600">ブラウザのサイト設定で通知がブロックされています。</p>
          ) : (
            <p className="text-sm text-gray-500">このブラウザでは通知を利用できません。</p>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={loadOverview} disabled={loading} title="通知情報を更新">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">通知を作成</CardTitle>
          <CardDescription>通知を許可している端末: {loading ? '確認中' : `${overview.subscriberCount}台`}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>送信先</Label>
            <div className="inline-flex rounded-md border bg-gray-50 p-1" role="group" aria-label="通知の送信先">
              <Button type="button" size="sm" variant={target === 'self' ? 'default' : 'ghost'} onClick={() => setTarget('self')}>
                <Smartphone className="mr-2 h-4 w-4" /> 自分へテスト
              </Button>
              <Button type="button" size="sm" variant={target === 'all' ? 'default' : 'ghost'} onClick={() => setTarget('all')}>
                <Users className="mr-2 h-4 w-4" /> 全ユーザー
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notification-title">タイトル</Label>
            <Input id="notification-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notification-body">本文</Label>
            <textarea
              id="notification-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={240}
              rows={4}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              placeholder="通知に表示する内容"
            />
            <p className="text-right text-xs text-gray-500">{body.length}/240</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notification-link">開くページ</Label>
            <Input id="notification-link" value={link} onChange={(event) => setLink(event.target.value)} maxLength={200} placeholder="/" />
            <p className="text-xs text-gray-500">Formix内のパスを `/` から指定します。</p>
          </div>

          {message && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
          {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end">
            <Button type="button" onClick={handleSend} disabled={sending || loading || !body.trim()}>
              <Send className="mr-2 h-4 w-4" />
              {sending ? '送信中...' : target === 'self' ? 'テスト送信' : '一斉送信'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-gray-900">配信履歴</h3>
          <Button type="button" variant="ghost" size="sm" onClick={loadOverview} disabled={loading} title="配信履歴を更新">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <div className="overflow-x-auto rounded-md border bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">日時</th>
                <th className="px-4 py-3 font-medium">タイトル</th>
                <th className="px-4 py-3 font-medium">対象</th>
                <th className="px-4 py-3 font-medium">成功 / 対象</th>
                <th className="px-4 py-3 font-medium">送信者</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {!loading && overview.campaigns.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">配信履歴はまだありません。</td></tr>
              )}
              {overview.campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatSentAt(campaign.sentAt)}</td>
                  <td className="max-w-xs px-4 py-3">
                    <p className="font-medium text-gray-900">{campaign.title}</p>
                    <p className="truncate text-xs text-gray-500">{campaign.body}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{campaign.target === 'all' ? '全ユーザー' : '自分'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{campaign.successCount} / {campaign.recipientCount}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{campaign.sentByEmail || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
