export type WrittenRubricScore = {
  criterionIndex: number;
  label: string;
  description: string;
  score: number;
  maxScore: number;
  comment: string;
};

export type WrittenRubricCriterion = {
  criterionIndex: number;
  label: string;
  description: string;
  maxScore: number;
};

function clampText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function parseNumericScore(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;

  // Gemini occasionally returns values such as "15点" or "15/15" despite a
  // numeric JSON example. Accept only a number at the start of the field so
  // unrelated digits in comments cannot be mistaken for a score.
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? numeric : null;
}

type RubricScorePayload = Record<string, unknown>;

function asPayload(value: unknown): RubricScorePayload {
  return value !== null && typeof value === "object"
    ? value as RubricScorePayload
    : {};
}

function readItemScore(item: RubricScorePayload): number | null {
  return parseNumericScore(
    item.score ?? item.awardedScore ?? item.earnedScore ?? item.points
  );
}

function distributeDelta(
  scores: number[],
  maxScores: number[],
  delta: number,
  direction: "increase" | "decrease"
): number[] {
  const result = [...scores];
  let remaining = Math.abs(delta);
  if (remaining === 0) return result;

  const weights = result.map((score, index) =>
    direction === "increase" ? maxScores[index] - score : score
  );
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) return result;

  const exactShares = weights.map((weight) => (remaining * weight) / totalWeight);
  const baseShares = exactShares.map((share) => Math.floor(share));
  baseShares.forEach((share, index) => {
    result[index] += direction === "increase" ? share : -share;
    remaining -= share;
  });

  const remainderOrder = exactShares
    .map((share, index) => ({ index, remainder: share - baseShares[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const { index } of remainderOrder) {
    if (remaining <= 0) break;
    if (direction === "increase" && result[index] < maxScores[index]) {
      result[index] += 1;
      remaining -= 1;
    } else if (direction === "decrease" && result[index] > 0) {
      result[index] -= 1;
      remaining -= 1;
    }
  }

  return result;
}

export function normalizeRubricScores(
  value: unknown,
  rubricCriteria: WrittenRubricCriterion[] = [],
  overallScore?: unknown
): WrittenRubricScore[] {
  if (!Array.isArray(value)) return [];
  const maxItems = rubricCriteria.length > 0 ? rubricCriteria.length : Math.min(value.length, 8);
  const unusedItems = value.slice(0, 8).map((item: unknown, index) => ({
    item: asPayload(item),
    index,
  }));

  const normalized = Array.from({ length: maxItems }).map((_, index) => {
    const criterion = rubricCriteria[index];
    let itemPosition = unusedItems.findIndex(({ item }) =>
      criterion && Number(item.criterionIndex) === criterion.criterionIndex
    );
    if (itemPosition < 0) {
      itemPosition = unusedItems.findIndex(({ item }) =>
        criterion && clampText(item.label, 80) === criterion.label
      );
    }
    if (itemPosition < 0) {
      itemPosition = unusedItems.findIndex(({ index: originalIndex }) => originalIndex === index);
    }
    const matched = itemPosition >= 0 ? unusedItems.splice(itemPosition, 1)[0]?.item : {};
    const maxScore = criterion?.maxScore
      ?? Math.max(1, Math.min(100, Math.round(parseNumericScore(matched.maxScore) ?? 100)));
    const parsedScore = readItemScore(matched);

    return {
      criterionIndex: criterion?.criterionIndex ?? index + 1,
      label: criterion?.label || clampText(matched.label, 80) || "評価項目",
      description: criterion?.description || clampText(matched.description ?? matched.criterionText, 800),
      score: Math.max(0, Math.min(maxScore, Math.round(parsedScore ?? 0))),
      maxScore,
      comment: clampText(matched.comment, 500),
    };
  });

  const parsedOverallScore = parseNumericScore(overallScore);
  if (parsedOverallScore === null || normalized.length === 0) return normalized;

  const maximumTotal = normalized.reduce((sum, item) => sum + item.maxScore, 0);
  const targetTotal = Math.max(0, Math.min(maximumTotal, Math.round(parsedOverallScore)));
  const currentTotal = normalized.reduce((sum, item) => sum + item.score, 0);
  if (currentTotal === targetTotal) return normalized;

  const reconciledScores = distributeDelta(
    normalized.map((item) => item.score),
    normalized.map((item) => item.maxScore),
    targetTotal - currentTotal,
    currentTotal < targetTotal ? "increase" : "decrease"
  );

  return normalized.map((item, index) => ({ ...item, score: reconciledScores[index] }));
}
