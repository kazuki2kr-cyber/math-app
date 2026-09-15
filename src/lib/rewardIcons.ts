export interface UnlockedRewardIcon {
  id: string;
  name: string;
  imageUrl: string;
  unlockedAt?: unknown;
  sourceUnitId?: string;
  sourceQuestionId?: string;
}

const REWARD_IMAGE_PATTERN = /^\/images\/reward-icons\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:png|webp|avif)$/;

export function isRewardIconImage(value: string | undefined | null): value is string {
  return typeof value === 'string' && REWARD_IMAGE_PATTERN.test(value) && !value.includes('..');
}

export function getUnlockedRewardIcons(value: unknown): UnlockedRewardIcon[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

  return Object.values(value as Record<string, unknown>)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      name: typeof item.name === 'string' ? item.name : '',
      imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : '',
      unlockedAt: item.unlockedAt,
      sourceUnitId: typeof item.sourceUnitId === 'string' ? item.sourceUnitId : undefined,
      sourceQuestionId: typeof item.sourceQuestionId === 'string' ? item.sourceQuestionId : undefined,
    }))
    .filter((item) => Boolean(item.id && item.name && isRewardIconImage(item.imageUrl)));
}
