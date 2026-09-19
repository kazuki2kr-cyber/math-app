function clampString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
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
