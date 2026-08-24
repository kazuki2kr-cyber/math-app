export const LEARNING_DAILY_RETENTION_DAYS = 28;

export interface LearningReviewStatsV1 {
  version: 1;
  startedAt: string;
  attemptCount: number;
  answeredCount: number;
  correctCount: number;
  studyTimeSec: number;
}

export interface LearningDailyStatsV1 {
  attempts: number;
  answered: number;
  correct: number;
  studyTimeSec: number;
}

type UnknownRecord = Record<string, unknown>;

function finiteNonNegative(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

export function getJstDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function updateLearningReviewStats(params: {
  existingReview: unknown;
  existingDaily: unknown;
  correctCount: number;
  answeredCount: number;
  studyTimeSec: number;
  now: Date;
}): {
  reviewV1: LearningReviewStatsV1;
  learningDailyV1: Record<string, LearningDailyStatsV1>;
} {
  const existingReview = asRecord(params.existingReview);
  const existingDaily = asRecord(params.existingDaily);
  const nowIso = params.now.toISOString();
  const todayKey = getJstDateKey(params.now);
  const oldestRetainedDate = new Date(params.now.getTime());
  oldestRetainedDate.setUTCDate(oldestRetainedDate.getUTCDate() - (LEARNING_DAILY_RETENTION_DAYS - 1));
  const oldestKey = getJstDateKey(oldestRetainedDate);

  const correctCount = finiteNonNegative(params.correctCount);
  const answeredCount = finiteNonNegative(params.answeredCount);
  const studyTimeSec = finiteNonNegative(params.studyTimeSec);

  const reviewV1: LearningReviewStatsV1 = {
    version: 1,
    startedAt: typeof existingReview.startedAt === "string"
      ? existingReview.startedAt
      : nowIso,
    attemptCount: finiteNonNegative(existingReview.attemptCount) + 1,
    answeredCount: finiteNonNegative(existingReview.answeredCount) + answeredCount,
    correctCount: finiteNonNegative(existingReview.correctCount) + correctCount,
    studyTimeSec: finiteNonNegative(existingReview.studyTimeSec) + studyTimeSec,
  };

  const learningDailyV1: Record<string, LearningDailyStatsV1> = {};
  for (const [dateKey, rawStats] of Object.entries(existingDaily)) {
    if (dateKey < oldestKey || dateKey > todayKey) continue;
    const stats = asRecord(rawStats);
    learningDailyV1[dateKey] = {
      attempts: finiteNonNegative(stats.attempts),
      answered: finiteNonNegative(stats.answered),
      correct: finiteNonNegative(stats.correct),
      studyTimeSec: finiteNonNegative(stats.studyTimeSec),
    };
  }

  const todayStats = learningDailyV1[todayKey] || {
    attempts: 0,
    answered: 0,
    correct: 0,
    studyTimeSec: 0,
  };
  learningDailyV1[todayKey] = {
    attempts: todayStats.attempts + 1,
    answered: todayStats.answered + answeredCount,
    correct: todayStats.correct + correctCount,
    studyTimeSec: todayStats.studyTimeSec + studyTimeSec,
  };

  return { reviewV1, learningDailyV1 };
}
