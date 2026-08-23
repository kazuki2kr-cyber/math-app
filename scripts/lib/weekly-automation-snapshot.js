'use strict';

const REDACTED = '[非表示]';
const JST_OFFSET = '+09:00';

function toDateKeyInTokyo(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function assertDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`日付は YYYY-MM-DD 形式で指定してください: ${value}`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`存在しない日付です: ${value}`);
  }
  return value;
}

function addDays(dateKey, amount) {
  assertDateKey(dateKey);
  const value = new Date(`${dateKey}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function buildWeeklyWindows(asOfDate = toDateKeyInTokyo()) {
  const asOf = assertDateKey(asOfDate);
  const currentStart = addDays(asOf, -6);
  const currentEndExclusive = addDays(asOf, 1);
  const previousStart = addDays(currentStart, -7);
  return {
    asOfDate: asOf,
    timezone: 'Asia/Tokyo',
    current: { startDate: currentStart, endDate: asOf, endExclusive: currentEndExclusive },
    previous: { startDate: previousStart, endDate: addDays(currentStart, -1), endExclusive: currentStart },
  };
}

function dateKeyToInstant(dateKey) {
  assertDateKey(dateKey);
  return new Date(`${dateKey}T00:00:00${JST_OFFSET}`);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function periodMatchesWindow(period, window) {
  return period
    && period.startDate === window.startDate
    && period.endDate === window.endDate;
}

function aggregateTrendDays(days, window, exactPeriod = null) {
  const selected = (Array.isArray(days) ? days : [])
    .filter((day) => typeof day?.date === 'string' && day.date >= window.startDate && day.date < window.endExclusive)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
  let totalAttempts = 0;
  let totalAnswered = 0;
  let totalCorrect = 0;
  let totalStudyTimeSec = 0;
  let activeLearnerDays = 0;
  let weightedAccuracyTotal = 0;
  let weightedAccuracyWeight = 0;
  let hasAnswerTotals = false;

  for (const day of selected) {
    const attempts = Math.max(0, finiteNumber(day.totalAttempts));
    const answered = Math.max(0, finiteNumber(day.totalAnswered));
    const correct = Math.max(0, finiteNumber(day.totalCorrect));
    const accuracy = finiteNumber(day.avgAccuracy, NaN);
    totalAttempts += attempts;
    totalStudyTimeSec += Math.max(0, finiteNumber(day.studyTimeSec));
    activeLearnerDays += Math.max(0, finiteNumber(day.uniqueUsers));
    if (Object.hasOwn(day, 'totalAnswered') && Object.hasOwn(day, 'totalCorrect')) {
      hasAnswerTotals = true;
      totalAnswered += answered;
      totalCorrect += Math.min(correct, answered);
    }
    if (Number.isFinite(accuracy) && attempts > 0) {
      weightedAccuracyTotal += accuracy * attempts;
      weightedAccuracyWeight += attempts;
    }
  }

  const exactAccuracy = hasAnswerTotals && totalAnswered > 0 ? (totalCorrect / totalAnswered) * 100 : null;
  const fallbackAccuracy = weightedAccuracyWeight > 0 ? weightedAccuracyTotal / weightedAccuracyWeight : null;
  const fallback = {
    startDate: window.startDate,
    endDate: window.endDate,
    calendarDaysWithData: selected.length,
    totalAttempts,
    totalAnswered: hasAnswerTotals ? totalAnswered : null,
    totalCorrect: hasAnswerTotals ? totalCorrect : null,
    avgAccuracy: round(exactAccuracy ?? fallbackAccuracy),
    avgAccuracyDefinition: exactAccuracy !== null
      ? 'totalCorrect / totalAnswered'
      : 'attempt-weighted mean of daily avgAccuracy (fallback)',
    totalStudyTimeSec,
    activeLearnerDays,
    uniqueLearners: null,
    uniqueLearnersReason: '日別ユニーク数から週次ユニーク数は復元できないため',
    mastery: {
      latestAnswerMasteryRate: null,
      masteredLearnerQuestions: null,
      eligibleLearnerQuestions: null,
      definition: '期間内の生徒×単元×問題ごとの最新回答が正解だった割合',
      unavailableReason: '週次の匿名化済み集計がないため',
    },
    nextItemCorrectness: {
      rateAfterError: null,
      correctTransitionsAfterError: null,
      eligibleTransitionsAfterError: null,
      definition: '同一演習内で誤答した直後の問題に正解した割合（AI支援効果ではない）',
      unavailableReason: '週次の匿名化済み集計がないため',
    },
  };

  if (!periodMatchesWindow(exactPeriod, window)) return fallback;
  const eligibleMastery = Math.max(0, finiteNumber(exactPeriod.eligibleLearnerQuestions));
  const mastered = Math.min(
    Math.max(0, finiteNumber(exactPeriod.masteredLearnerQuestions)),
    eligibleMastery,
  );
  const eligibleTransitions = Math.max(0, finiteNumber(exactPeriod.eligibleTransitionsAfterError));
  const correctTransitions = Math.min(
    Math.max(0, finiteNumber(exactPeriod.correctTransitionsAfterError)),
    eligibleTransitions,
  );
  const masteryRate = eligibleMastery > 0
    ? optionalFiniteNumber(exactPeriod.latestAnswerMasteryRate)
    : null;
  const nextItemRate = eligibleTransitions > 0
    ? optionalFiniteNumber(exactPeriod.nextItemCorrectnessRateAfterError)
    : null;
  const totalAnsweredExact = Math.max(0, finiteNumber(exactPeriod.totalAnswered));
  return {
    startDate: window.startDate,
    endDate: window.endDate,
    calendarDaysWithData: Math.max(0, finiteNumber(exactPeriod.calendarDaysWithData)),
    totalAttempts: Math.max(0, finiteNumber(exactPeriod.totalAttempts)),
    totalAnswered: totalAnsweredExact,
    totalCorrect: Math.max(0, finiteNumber(exactPeriod.totalCorrect)),
    avgAccuracy: totalAnsweredExact > 0 ? round(optionalFiniteNumber(exactPeriod.avgAccuracy)) : null,
    avgAccuracyDefinition: 'totalCorrect / totalAnswered',
    totalStudyTimeSec: Math.max(0, finiteNumber(exactPeriod.totalStudyTimeSec)),
    activeLearnerDays: Math.max(0, finiteNumber(exactPeriod.activeLearnerDays)),
    uniqueLearners: Math.max(0, finiteNumber(exactPeriod.uniqueLearners)),
    uniqueLearnersReason: null,
    mastery: {
      latestAnswerMasteryRate: round(masteryRate),
      masteredLearnerQuestions: eligibleMastery > 0 ? mastered : null,
      eligibleLearnerQuestions: eligibleMastery > 0 ? eligibleMastery : null,
      definition: '期間内の生徒×単元×問題ごとの最新回答が正解だった割合',
      unavailableReason: masteryRate === null ? 'この集計では習熟指標を利用できないため' : null,
    },
    nextItemCorrectness: {
      rateAfterError: round(nextItemRate),
      correctTransitionsAfterError: eligibleTransitions > 0 ? correctTransitions : null,
      eligibleTransitionsAfterError: eligibleTransitions > 0 ? eligibleTransitions : null,
      definition: '同一演習内で誤答した直後の問題に正解した割合（AI支援効果ではない）',
      unavailableReason: nextItemRate === null ? 'この集計では誤答後遷移指標を利用できないため' : null,
    },
  };
}

function buildCategoryCoverage(categoryPeriods, overallPeriod) {
  const reported = categoryPeriods.reduce((totals, period) => ({
    totalAttempts: totals.totalAttempts + Math.max(0, finiteNumber(period.totalAttempts)),
    totalAnswered: totals.totalAnswered + Math.max(0, finiteNumber(period.totalAnswered)),
    totalCorrect: totals.totalCorrect + Math.max(0, finiteNumber(period.totalCorrect)),
    totalStudyTimeSec: totals.totalStudyTimeSec + Math.max(0, finiteNumber(period.totalStudyTimeSec)),
  }), { totalAttempts: 0, totalAnswered: 0, totalCorrect: 0, totalStudyTimeSec: 0 });
  const overallAttempts = Math.max(0, finiteNumber(overallPeriod.totalAttempts));
  const overallAnswered = Math.max(0, finiteNumber(overallPeriod.totalAnswered));
  const overallStudyTimeSec = Math.max(0, finiteNumber(overallPeriod.totalStudyTimeSec));
  return {
    reportedCategoryCount: categoryPeriods.filter((period) => period.totalAttempts > 0).length,
    reportedAttempts: reported.totalAttempts,
    reportedAnswered: reported.totalAnswered,
    reportedCorrect: Math.min(reported.totalCorrect, reported.totalAnswered),
    reportedStudyTimeSec: reported.totalStudyTimeSec,
    unavailableByCategoryAttempts: Math.max(0, overallAttempts - reported.totalAttempts),
    unavailableByCategoryAnswered: Math.max(0, overallAnswered - reported.totalAnswered),
    unavailableByCategoryStudyTimeSec: Math.max(0, overallStudyTimeSec - reported.totalStudyTimeSec),
    reportedAttemptShare: overallAttempts > 0 ? round((reported.totalAttempts / overallAttempts) * 100) : null,
    reason: reported.totalAttempts < overallAttempts
      ? '少人数保護で非表示のカテゴリ、またはカテゴリ情報を補完できない演習があるため'
      : null,
  };
}

function timestampToIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value._seconds === 'number') return new Date(value._seconds * 1000).toISOString();
  return null;
}

function redactLiteral(text, literal) {
  const value = String(literal || '').trim();
  return value.length >= 2 ? text.split(value).join(REDACTED) : text;
}

function sanitizeFreeText(input, knownIdentifiers = [], maxLength = 600) {
  let text = String(input || '').normalize('NFKC').replace(/[\u0000-\u001F\u007F]/g, ' ');
  for (const identifier of knownIdentifiers) text = redactLiteral(text, identifier);
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED)
    .replace(/https?:\/\/[^\s、。]+/gi, REDACTED)
    .replace(/(?:\+?81[-\s]?)?(?:0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})/g, REDACTED)
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, REDACTED)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizePageGroup(pagePath) {
  const page = String(pagePath || '').split(/[?#]/, 1)[0];
  if (page === '/') return '/';
  const allowed = ['/drill', '/written', '/battle', '/yamato', '/notifications', '/login'];
  return allowed.find((prefix) => page === prefix || page.startsWith(`${prefix}/`)) || '/other';
}

function normalizeEnum(value, allowed) {
  const normalized = String(value || '');
  return allowed.includes(normalized) ? normalized : null;
}

function sanitizeGeneralFeedback(data) {
  const identifiers = [data.uid, data.userName, data.userEmail];
  return {
    kind: 'general',
    createdAt: timestampToIso(data.createdAt),
    status: normalizeEnum(data.status, ['new', 'reviewed', 'resolved']) || 'other',
    pageGroup: normalizePageGroup(data.pagePath),
    message: sanitizeFreeText(data.message, identifiers),
  };
}

function sanitizeWrittenFeedback(data) {
  const identifiers = [data.uid, data.userName, data.userEmail, data.attemptId];
  return {
    kind: 'written_grading',
    createdAt: timestampToIso(data.createdAt),
    status: normalizeEnum(data.status, ['new', 'reviewed', 'resolved']) || 'other',
    unitTitle: sanitizeFreeText(data.unitTitle, identifiers, 160),
    rating: normalizeEnum(data.rating, ['helpful', 'partly_helpful', 'not_helpful']),
    strictness: normalizeEnum(data.strictness, ['too_lenient', 'appropriate', 'too_strict', 'unsure']),
    usefulness: normalizeEnum(data.usefulness, ['very_useful', 'somewhat_useful', 'not_useful']),
    clarity: normalizeEnum(data.clarity, ['clear', 'somewhat_unclear', 'unclear']),
    message: sanitizeFreeText(data.message, identifiers),
  };
}

function summarizeFeedback(items) {
  const summary = { total: items.length, byKind: { general: 0, written_grading: 0 }, byStatus: {} };
  for (const item of items) {
    if (Object.hasOwn(summary.byKind, item.kind)) summary.byKind[item.kind] += 1;
    summary.byStatus[item.status] = (summary.byStatus[item.status] || 0) + 1;
  }
  return summary;
}

function safeAllTimeTotals(totals = {}) {
  return {
    totalAttempts: Math.max(0, finiteNumber(totals.totalAttempts)),
    uniqueUsers: Math.max(0, finiteNumber(totals.uniqueUsers)),
    avgAccuracy: round(finiteNumber(totals.avgAccuracy)),
    totalAnswered: Math.max(0, finiteNumber(totals.totalAnswered)),
    totalCorrect: Math.max(0, finiteNumber(totals.totalCorrect)),
    totalStudyTimeSec: Math.max(0, finiteNumber(totals.totalStudyTimeSec)),
    dau: Math.max(0, finiteNumber(totals.dau)),
    wau: Math.max(0, finiteNumber(totals.wau)),
    mau: Math.max(0, finiteNumber(totals.mau)),
  };
}

function buildAnalyticsSection({ overview = {}, trends = {}, categories = [] }, windows) {
  const weeklyPeriods = Array.isArray(trends.weeklyPeriods) ? trends.weeklyPeriods : [];
  const currentWeekly = weeklyPeriods.find((period) => periodMatchesWindow(period, windows.current));
  const previousWeekly = weeklyPeriods.find((period) => periodMatchesWindow(period, windows.previous));
  const currentPeriod = aggregateTrendDays(trends.days, windows.current, currentWeekly);
  const previousPeriod = aggregateTrendDays(trends.days, windows.previous, previousWeekly);
  const mappedCategories = categories.map((category) => {
    const categoryWeeklyPeriods = Array.isArray(category.trends?.weeklyPeriods)
      ? category.trends.weeklyPeriods
      : [];
    return {
      category: sanitizeFreeText(category.category, [], 120),
      allTime: safeAllTimeTotals(category.totals),
      currentPeriod: aggregateTrendDays(
        category.trends?.days,
        windows.current,
        categoryWeeklyPeriods.find((period) => periodMatchesWindow(period, windows.current)),
      ),
      previousPeriod: aggregateTrendDays(
        category.trends?.days,
        windows.previous,
        categoryWeeklyPeriods.find((period) => periodMatchesWindow(period, windows.previous)),
      ),
    };
  });
  return {
    source: 'public_analytics_serving/current',
    generatedAt: timestampToIso(overview.generatedAt || trends.generatedAt),
    privacy: {
      pii: false,
      publishable: overview.privacy?.publishable === true,
      suppressedReason: overview.privacy?.suppressedReason || null,
      suppressedLowSupportRows: overview.privacy?.suppressedLowSupportRows !== false,
    },
    allTime: safeAllTimeTotals(overview.totals),
    insights: {
      initialStumbleRate: round(finiteNumber(overview.insights?.initialStumbleRate)),
      retryImprovementRate: round(finiteNumber(overview.insights?.retryImprovementRate)),
      persistentStruggleQuestions: Math.max(0, finiteNumber(overview.insights?.persistentStruggleQuestions)),
      coMistakePairs: Math.max(0, finiteNumber(overview.insights?.coMistakePairs)),
    },
    currentPeriod,
    previousPeriod,
    categoryCoverage: {
      currentPeriod: buildCategoryCoverage(
        mappedCategories.map((category) => category.currentPeriod),
        currentPeriod,
      ),
      previousPeriod: buildCategoryCoverage(
        mappedCategories.map((category) => category.previousPeriod),
        previousPeriod,
      ),
    },
    categories: mappedCategories,
  };
}

function buildSnapshot({ asOfDate, projectId, overview, trends, categories, generalFeedback, writtenFeedback, errors = [] }) {
  const periods = buildWeeklyWindows(asOfDate);
  const items = [
    ...(Array.isArray(generalFeedback) ? generalFeedback.map(sanitizeGeneralFeedback) : []),
    ...(Array.isArray(writtenFeedback) ? writtenFeedback.map(sanitizeWrittenFeedback) : []),
  ].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    projectId,
    status: errors.length === 0 ? 'complete' : 'partial',
    periods,
    analytics: buildAnalyticsSection({ overview, trends, categories }, periods),
    feedback: {
      sourceCollections: ['user_feedback', 'written_grading_feedback'],
      period: periods.current,
      privacy: {
        directIdentifiersRemoved: true,
        deviceInformationRemoved: true,
        individualScoresRemoved: true,
        freeTextRedactionApplied: true,
      },
      summary: summarizeFeedback(items),
      items,
    },
    errors,
    definitions: {
      totalAttempts: '完了した演習（attempt）の件数。問題回答数ではない。',
      activeLearnerDays: '日別ユニーク学習者数の合計。週次ユニーク学習者数ではない。',
      uniqueLearners: '対象7日間に1回以上演習を完了した重複なしの学習者数。5人未満の期間は出力しない。',
      latestAnswerMasteryRate: '対象7日間の生徒×単元×問題ごとに最新回答を1件選び、その正答割合を集計した習熟の代理指標。',
      nextItemCorrectnessRateAfterError: '同一演習内で誤答した直後の問題に正解した割合。AIチューターやヒントの因果効果は示さない。',
      categoryCoverage: '週次全体のうち、少人数保護を満たしてカテゴリ別に表示できた演習の範囲。カテゴリ間のuniqueLearnersは合算しない。',
      currentPeriod: '日本時間で実行日を含む直近7暦日。',
      previousPeriod: 'currentPeriodの直前7暦日。',
    },
  };
}

module.exports = {
  addDays,
  aggregateTrendDays,
  buildSnapshot,
  buildWeeklyWindows,
  dateKeyToInstant,
  normalizePageGroup,
  sanitizeFreeText,
  sanitizeGeneralFeedback,
  sanitizeWrittenFeedback,
  timestampToIso,
  toDateKeyInTokyo,
};
