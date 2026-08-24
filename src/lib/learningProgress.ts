export const LEARNING_PROGRESS_TRACKING_VERSION = 1;
export const LEARNING_DAILY_WINDOW_DAYS = 28;
export const LEARNING_PROGRESS_MIN_ATTEMPTS = 3;
export const LEARNING_PROGRESS_MIN_ANSWERS = 20;

export type LearningStatus = 'unstarted' | 'insufficient' | 'review' | 'almost' | 'mastered';
export type RecommendedDrillMode = 'standard' | 'wrong';

export interface LearningReviewStatsV1 {
  version?: number;
  startedAt?: string;
  attemptCount?: number;
  answeredCount?: number;
  correctCount?: number;
  studyTimeSec?: number;
}

export interface LearningUnitStat {
  drillCount?: number;
  wrongQuestionIds?: string[];
  updatedAt?: string;
  reviewV1?: LearningReviewStatsV1;
}

export interface LearningDailyStat {
  attempts?: number;
  answered?: number;
  correct?: number;
  studyTimeSec?: number;
}

export interface LearningProgressUserData {
  unitStats?: Record<string, unknown>;
  learningDailyV1?: Record<string, LearningDailyStat>;
}

export interface LearningProgressUnitSource {
  id: string;
  title: string;
  category?: string;
  subject?: string;
  drillType?: 'multiple_choice' | 'written';
  totalQuestions?: number;
  questions?: unknown[];
}

export interface LearningUnitProgress {
  id: string;
  title: string;
  category: string;
  allTimeAttempts: number;
  trackedAttempts: number;
  answeredCount: number;
  correctCount: number;
  studyTimeSec: number;
  accuracy: number | null;
  wrongCount: number;
  lastAttemptAt: string | null;
  trackingStartedAt: string | null;
  status: LearningStatus;
  statusLabel: string;
  recommendationReason: string;
  recommendedMode: RecommendedDrillMode;
  priority: number;
  stale: boolean;
}

export interface LearningCategoryProgress {
  category: string;
  allTimeAttempts: number;
  trackedAttempts: number;
  answeredCount: number;
  correctCount: number;
  studyTimeSec: number;
  accuracy: number | null;
  masteredUnits: number;
  touchedUnits: number;
  totalUnits: number;
}

export interface LearningDailyProgress {
  date: string;
  attempts: number;
  answered: number;
  correct: number;
  studyTimeSec: number;
  accuracy: number | null;
}

export interface LearningProgressReport {
  units: LearningUnitProgress[];
  recommendations: LearningUnitProgress[];
  categories: LearningCategoryProgress[];
  daily: LearningDailyProgress[];
  overall: {
    allTimeAttempts: number;
    trackedAttempts: number;
    answeredCount: number;
    correctCount: number;
    studyTimeSec: number;
    accuracy: number | null;
    masteredUnits: number;
    touchedUnits: number;
    totalUnits: number;
    trackingStartedAt: string | null;
  };
}

export interface LearningProgressReadiness {
  ready: boolean;
  remainingAttempts: number;
  remainingAnswers: number;
}

const STATUS_LABELS: Record<LearningStatus, string> = {
  unstarted: '未着手',
  insufficient: 'データ不足',
  review: '復習優先',
  almost: 'あと少し',
  mastered: '定着',
};

function toNonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function getLearningUnitStat(
  unitStats: Record<string, unknown> | undefined,
  unitId: string,
): LearningUnitStat {
  if (!unitStats) return {};
  const direct = unitStats[unitId];
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    return direct as LearningUnitStat;
  }

  let current: unknown = unitStats;
  for (const segment of unitId.split('.')) {
    const record = asRecord(current);
    if (!(segment in record)) return {};
    current = record[segment];
  }
  return asRecord(current) as LearningUnitStat;
}

function calculateAccuracy(correct: number, answered: number): number | null {
  return answered > 0 ? Math.round((correct / answered) * 1000) / 10 : null;
}

function daysSince(isoDate: string | undefined, now: Date): number | null {
  if (!isoDate) return null;
  const timestamp = Date.parse(isoDate);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000));
}

function evaluateUnit(params: {
  allTimeAttempts: number;
  trackedAttempts: number;
  answeredCount: number;
  accuracy: number | null;
  wrongCount: number;
  stale: boolean;
}): Pick<LearningUnitProgress, 'status' | 'recommendationReason' | 'priority' | 'recommendedMode'> {
  const { allTimeAttempts, trackedAttempts, answeredCount, accuracy, wrongCount, stale } = params;
  const recommendedMode: RecommendedDrillMode = wrongCount > 0 ? 'wrong' : 'standard';

  if (allTimeAttempts === 0) {
    return {
      status: 'unstarted',
      recommendationReason: 'まだ取り組んでいない単元です。最初の演習から始めましょう。',
      priority: 50,
      recommendedMode: 'standard',
    };
  }

  if (trackedAttempts < 2 || answeredCount < 10 || accuracy === null) {
    return {
      status: 'insufficient',
      recommendationReason: wrongCount > 0
        ? `間違いが${wrongCount}問残っています。復習すると学習状況をより正確に判定できます。`
        : '正答率を判定するため、もう一度取り組んでみましょう。',
      priority: 65 + Math.min(15, wrongCount * 3),
      recommendedMode,
    };
  }

  if (accuracy < 70) {
    return {
      status: 'review',
      recommendationReason: wrongCount > 0
        ? `正答率${accuracy}%で、間違いが${wrongCount}問残っています。`
        : `正答率${accuracy}%です。解き方を確認してもう一度挑戦しましょう。`,
      priority: 100 + (70 - accuracy) + Math.min(15, wrongCount * 3),
      recommendedMode,
    };
  }

  if (accuracy >= 85 && trackedAttempts >= 3 && answeredCount >= 20 && wrongCount === 0) {
    return {
      status: 'mastered',
      recommendationReason: stale
        ? 'よく定着しています。しばらく間が空いたので、短くおさらいしてもよいでしょう。'
        : '十分に取り組めています。次の単元へ進みましょう。',
      priority: stale ? 30 : 0,
      recommendedMode: 'standard',
    };
  }

  return {
    status: 'almost',
    recommendationReason: wrongCount > 0
      ? `正答率${accuracy}%です。残り${wrongCount}問を復習すると定着に近づきます。`
      : `正答率${accuracy}%です。あと少し演習を重ねると定着判定になります。`,
    priority: 80 + Math.max(0, 85 - accuracy) + Math.min(10, wrongCount * 2),
    recommendedMode,
  };
}

function getJstDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function buildDailyProgress(
  rawDaily: Record<string, LearningDailyStat> | undefined,
  now: Date,
): LearningDailyProgress[] {
  const daily = rawDaily || {};
  return Array.from({ length: LEARNING_DAILY_WINDOW_DAYS }, (_, reverseIndex) => {
    const daysAgo = LEARNING_DAILY_WINDOW_DAYS - reverseIndex - 1;
    const date = new Date(now.getTime());
    date.setUTCDate(date.getUTCDate() - daysAgo);
    const dateKey = getJstDateKey(date);
    const raw = daily[dateKey] || {};
    const attempts = toNonNegativeNumber(raw.attempts);
    const answered = toNonNegativeNumber(raw.answered);
    const correct = toNonNegativeNumber(raw.correct);
    const studyTimeSec = toNonNegativeNumber(raw.studyTimeSec);
    return {
      date: dateKey,
      attempts,
      answered,
      correct,
      studyTimeSec,
      accuracy: calculateAccuracy(correct, answered),
    };
  });
}

export function buildLearningProgressReport(
  sourceUnits: LearningProgressUnitSource[],
  userData: LearningProgressUserData,
  now = new Date(),
): LearningProgressReport {
  const units = sourceUnits
    .filter((unit) => unit.drillType !== 'written')
    .map<LearningUnitProgress>((unit) => {
      const stat = getLearningUnitStat(userData.unitStats, unit.id);
      const review = stat.reviewV1 || {};
      const allTimeAttempts = toNonNegativeNumber(stat.drillCount);
      const trackedAttempts = toNonNegativeNumber(review.attemptCount);
      const answeredCount = toNonNegativeNumber(review.answeredCount);
      const correctCount = toNonNegativeNumber(review.correctCount);
      const studyTimeSec = toNonNegativeNumber(review.studyTimeSec);
      const wrongCount = Array.isArray(stat.wrongQuestionIds) ? stat.wrongQuestionIds.length : 0;
      const accuracy = calculateAccuracy(correctCount, answeredCount);
      const elapsedDays = daysSince(stat.updatedAt, now);
      const stale = elapsedDays !== null && elapsedDays >= 30;
      const evaluation = evaluateUnit({
        allTimeAttempts,
        trackedAttempts,
        answeredCount,
        accuracy,
        wrongCount,
        stale,
      });

      return {
        id: unit.id,
        title: unit.title.replace(/^単元\s*/, ''),
        category: unit.category || 'その他',
        allTimeAttempts,
        trackedAttempts,
        answeredCount,
        correctCount,
        studyTimeSec,
        accuracy,
        wrongCount,
        lastAttemptAt: typeof stat.updatedAt === 'string' ? stat.updatedAt : null,
        trackingStartedAt: typeof review.startedAt === 'string' ? review.startedAt : null,
        status: evaluation.status,
        statusLabel: STATUS_LABELS[evaluation.status],
        recommendationReason: evaluation.recommendationReason,
        recommendedMode: evaluation.recommendedMode,
        priority: evaluation.priority,
        stale,
      };
    });

  const categoriesByName = new Map<string, LearningCategoryProgress>();
  for (const unit of units) {
    const existing = categoriesByName.get(unit.category) || {
      category: unit.category,
      allTimeAttempts: 0,
      trackedAttempts: 0,
      answeredCount: 0,
      correctCount: 0,
      studyTimeSec: 0,
      accuracy: null,
      masteredUnits: 0,
      touchedUnits: 0,
      totalUnits: 0,
    };
    existing.allTimeAttempts += unit.allTimeAttempts;
    existing.trackedAttempts += unit.trackedAttempts;
    existing.answeredCount += unit.answeredCount;
    existing.correctCount += unit.correctCount;
    existing.studyTimeSec += unit.studyTimeSec;
    existing.masteredUnits += unit.status === 'mastered' ? 1 : 0;
    existing.touchedUnits += unit.allTimeAttempts > 0 ? 1 : 0;
    existing.totalUnits += 1;
    existing.accuracy = calculateAccuracy(existing.correctCount, existing.answeredCount);
    categoriesByName.set(unit.category, existing);
  }

  const totals = units.reduce((accumulator, unit) => {
    accumulator.allTimeAttempts += unit.allTimeAttempts;
    accumulator.trackedAttempts += unit.trackedAttempts;
    accumulator.answeredCount += unit.answeredCount;
    accumulator.correctCount += unit.correctCount;
    accumulator.studyTimeSec += unit.studyTimeSec;
    accumulator.masteredUnits += unit.status === 'mastered' ? 1 : 0;
    accumulator.touchedUnits += unit.allTimeAttempts > 0 ? 1 : 0;
    if (
      unit.trackingStartedAt
      && (!accumulator.trackingStartedAt || unit.trackingStartedAt < accumulator.trackingStartedAt)
    ) {
      accumulator.trackingStartedAt = unit.trackingStartedAt;
    }
    return accumulator;
  }, {
    allTimeAttempts: 0,
    trackedAttempts: 0,
    answeredCount: 0,
    correctCount: 0,
    studyTimeSec: 0,
    masteredUnits: 0,
    touchedUnits: 0,
    trackingStartedAt: null as string | null,
  });

  return {
    units,
    recommendations: [...units]
      .filter((unit) => unit.priority > 0)
      .sort((left, right) => right.priority - left.priority || left.title.localeCompare(right.title, 'ja'))
      .slice(0, 3),
    categories: [...categoriesByName.values()].sort((left, right) => left.category.localeCompare(right.category, 'ja', { numeric: true })),
    daily: buildDailyProgress(userData.learningDailyV1, now),
    overall: {
      ...totals,
      accuracy: calculateAccuracy(totals.correctCount, totals.answeredCount),
      totalUnits: units.length,
    },
  };
}

export function getLearningProgressReadiness(report: LearningProgressReport): LearningProgressReadiness {
  const remainingAttempts = Math.max(0, LEARNING_PROGRESS_MIN_ATTEMPTS - report.overall.trackedAttempts);
  const remainingAnswers = Math.max(0, LEARNING_PROGRESS_MIN_ANSWERS - report.overall.answeredCount);
  return {
    ready: remainingAttempts === 0 && remainingAnswers === 0,
    remainingAttempts,
    remainingAnswers,
  };
}
