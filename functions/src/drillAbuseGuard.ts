export const DRILL_GUARD_POLICY = {
  dailyXpCap: 5000,
  dailyAttemptLimit: 150,
  hardMinimumIntervalSec: 5,
  burstIntervalSec: 15,
  burstLimit: 3,
  impossibleAverageSecondsPerQuestion: 0.3,
  integritySampleIntervalSec: 15 * 60,
} as const;

export type DrillGuardState = {
  logicalDate: string;
  acceptedAttempts: number;
  earnedXp: number;
  consecutiveBurstCount: number;
  lastAcceptedAtMs: number | null;
  lastSampledAtMs: number | null;
};

export type DrillGuardDecision = {
  blocked: boolean;
  blockCode: "impossible_speed" | "submission_burst" | "daily_attempt_limit" | null;
  reason: string | null;
  retryAfterSeconds: number | null;
  intervalSec: number | null;
  nextBurstCount: number;
};

type EvaluateDrillGuardInput = {
  state: DrillGuardState;
  nowMs: number;
  timeSec: number;
  answeredCount: number;
};

function finiteNonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function normalizeDrillGuardState(
  raw: unknown,
  logicalDate: string,
  parseTimestampMs: (value: unknown) => number | null,
): DrillGuardState {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const isCurrentDay = value.logicalDate === logicalDate;

  return {
    logicalDate,
    acceptedAttempts: isCurrentDay ? finiteNonNegative(value.acceptedAttempts) : 0,
    earnedXp: isCurrentDay ? finiteNonNegative(value.earnedXp) : 0,
    consecutiveBurstCount: isCurrentDay ? finiteNonNegative(value.consecutiveBurstCount) : 0,
    lastAcceptedAtMs: parseTimestampMs(value.lastAcceptedAt),
    lastSampledAtMs: parseTimestampMs(value.lastSampledAt),
  };
}

export function evaluateDrillGuard({
  state,
  nowMs,
  timeSec,
  answeredCount,
}: EvaluateDrillGuardInput): DrillGuardDecision {
  const intervalSec = state.lastAcceptedAtMs === null
    ? null
    : Math.max(0, (nowMs - state.lastAcceptedAtMs) / 1000);
  const averageSecondsPerQuestion = timeSec / Math.max(1, answeredCount);
  const isBurst = answeredCount >= 10
    && intervalSec !== null
    && intervalSec < DRILL_GUARD_POLICY.burstIntervalSec;
  const nextBurstCount = isBurst ? state.consecutiveBurstCount + 1 : 0;

  if (state.acceptedAttempts >= DRILL_GUARD_POLICY.dailyAttemptLimit) {
    return {
      blocked: true,
      blockCode: "daily_attempt_limit",
      reason: `1日の演習回数が上限（${DRILL_GUARD_POLICY.dailyAttemptLimit}回）に達しています`,
      retryAfterSeconds: null,
      intervalSec,
      nextBurstCount,
    };
  }

  if (answeredCount >= 10 && averageSecondsPerQuestion < DRILL_GUARD_POLICY.impossibleAverageSecondsPerQuestion) {
    return {
      blocked: true,
      blockCode: "impossible_speed",
      reason: `平均解答時間が${averageSecondsPerQuestion.toFixed(2)}秒/問`,
      retryAfterSeconds: DRILL_GUARD_POLICY.hardMinimumIntervalSec,
      intervalSec,
      nextBurstCount,
    };
  }

  if (
    answeredCount >= 10
    && intervalSec !== null
    && (
      intervalSec < DRILL_GUARD_POLICY.hardMinimumIntervalSec
      || nextBurstCount >= DRILL_GUARD_POLICY.burstLimit
    )
  ) {
    return {
      blocked: true,
      blockCode: "submission_burst",
      reason: `演習結果が短時間に連続送信されています（${intervalSec.toFixed(1)}秒間隔）`,
      retryAfterSeconds: Math.max(1, Math.ceil(DRILL_GUARD_POLICY.burstIntervalSec - intervalSec)),
      intervalSec,
      nextBurstCount,
    };
  }

  return {
    blocked: false,
    blockCode: null,
    reason: null,
    retryAfterSeconds: null,
    intervalSec,
    nextBurstCount,
  };
}

export function applyDailyXpCap(
  proposedXp: number,
  alreadyEarnedXp: number,
  xpEarningLocked: boolean,
): { awardedXp: number; capped: boolean } {
  const safeProposed = Math.max(0, Math.floor(proposedXp));
  if (xpEarningLocked) return { awardedXp: 0, capped: safeProposed > 0 };

  const remaining = Math.max(0, DRILL_GUARD_POLICY.dailyXpCap - finiteNonNegative(alreadyEarnedXp));
  const awardedXp = Math.min(safeProposed, remaining);
  return { awardedXp, capped: awardedXp < safeProposed };
}

export function shouldSampleIntegrityEvent(lastSampledAtMs: number | null, nowMs: number): boolean {
  return lastSampledAtMs === null
    || nowMs - lastSampledAtMs >= DRILL_GUARD_POLICY.integritySampleIntervalSec * 1000;
}

export function getRepeatedUnitXpRate(attemptNumber: number): number {
  if (attemptNumber <= 3) return 1;
  if (attemptNumber <= 5) return 0.7;
  if (attemptNumber <= 10) return 0.3;
  if (attemptNumber <= 20) return 0.1;
  return 0;
}
