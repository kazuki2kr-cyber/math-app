export const WRITTEN_SCORE_REWARD_CONDITION = "written_score_at_least" as const;

export type IconReward = {
  id: string;
  name: string;
  imageUrl: string;
  condition: {
    type: typeof WRITTEN_SCORE_REWARD_CONDITION;
    value: number;
  };
};

const REWARD_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REWARD_IMAGE_PATTERN = /^\/images\/reward-icons\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:png|webp|avif)$/;

export function normalizeIconReward(value: unknown): IconReward | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const condition = raw.condition;
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return null;

  const rawCondition = condition as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";
  const imageUrl = typeof raw.imageUrl === "string" ? raw.imageUrl.trim() : "";
  const conditionType = rawCondition.type;
  const conditionValue = Number(rawCondition.value);

  if (!REWARD_ID_PATTERN.test(id) || !name || !REWARD_IMAGE_PATTERN.test(imageUrl)) return null;
  if (imageUrl.includes("..") || conditionType !== WRITTEN_SCORE_REWARD_CONDITION) return null;
  if (!Number.isFinite(conditionValue) || conditionValue < 0 || conditionValue > 100) return null;

  return {
    id,
    name,
    imageUrl,
    condition: {
      type: WRITTEN_SCORE_REWARD_CONDITION,
      value: Math.round(conditionValue),
    },
  };
}

export function getEarnedWrittenIconReward(value: unknown, score: number): IconReward | null {
  const reward = normalizeIconReward(value);
  if (!reward) return null;
  return score >= reward.condition.value ? reward : null;
}
