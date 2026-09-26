function clampString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

const MAX_NOTIFICATION_READ_IDS = 200;

export function normalizeNotificationReadIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((item) => clampString(item, 128))
    .filter((item) => /^[A-Za-z0-9_-]{1,128}$/.test(item));
  return Array.from(new Set(ids)).slice(0, MAX_NOTIFICATION_READ_IDS);
}

export function mergeNotificationReadIds(
  existingValue: unknown,
  incomingValue: unknown,
  allowedValue: unknown,
) {
  const allowedIds = new Set(normalizeNotificationReadIds(allowedValue));
  return normalizeNotificationReadIds([
    ...normalizeNotificationReadIds(incomingValue),
    ...normalizeNotificationReadIds(existingValue),
  ]).filter((id) => allowedIds.has(id));
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

export function canReadNotificationSummaryItem(
  item: { target: 'self' | 'all'; sentByUid: string },
  uid: string,
) {
  return item.target === 'all' || (item.target === 'self' && item.sentByUid === uid);
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
