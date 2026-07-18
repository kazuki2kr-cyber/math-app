export type NotificationTarget = 'self' | 'all';

export type PushNotificationPayload = {
  title: string;
  body: string;
  link: string;
  target: NotificationTarget;
};

function clampString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function normalizePushNotificationPayload(data: unknown): PushNotificationPayload {
  const input = (data || {}) as Record<string, unknown>;
  const title = clampString(input.title, 60);
  const body = clampString(input.body, 240);
  const rawLink = clampString(input.link, 200) || '/';
  const target: NotificationTarget = input.target === 'self' ? 'self' : input.target === 'all' ? 'all' : 'self';

  if (!title || !body) {
    throw new Error('通知のタイトルと本文を入力してください。');
  }
  if (!rawLink.startsWith('/') || rawLink.startsWith('//')) {
    throw new Error('リンクはFormix内の相対パスで指定してください。');
  }

  return { title, body, link: rawLink, target };
}
