const MAX_NOTIFICATION_IDS = 200;

export function normalizeNotificationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((item): item is string => (
    typeof item === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item)
  ));
  return Array.from(new Set(ids)).slice(0, MAX_NOTIFICATION_IDS);
}

export function addNotificationId(ids: string[], notificationId: string): string[] {
  return normalizeNotificationIds([notificationId, ...ids]);
}

export function markNotificationIdsRead(readIds: string[], notificationIds: string[]): string[] {
  return normalizeNotificationIds([...notificationIds, ...readIds]);
}

export function getUnreadNotificationIds(campaignIds: string[], readIds: string[]): string[] {
  const readIdSet = new Set(normalizeNotificationIds(readIds));
  return normalizeNotificationIds(campaignIds).filter((id) => !readIdSet.has(id));
}
