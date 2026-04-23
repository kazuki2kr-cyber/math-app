import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { CorrelationPair, OverviewMetrics, QuestionStat, StudentRank } from '@/lib/analytics';

export interface AnalyticsOverviewDoc {
  generatedAt?: unknown;
  sourceWindow?: {
    startDate?: string;
    endDate?: string;
  };
  totals?: {
    totalAttempts?: number;
    uniqueUsers?: number;
    avgAccuracy?: number;
    totalAnswered?: number;
    totalCorrect?: number;
    totalStudyTimeSec?: number;
    dau?: number;
    wau?: number;
    mau?: number;
    avgAttemptsPerUser?: number;
    retryImprovementRate?: number;
    firstAttemptAccuracy?: number;
    atRiskUsers?: number;
  };
  bySubject?: Array<{
    subject: string;
    totalAttempts: number;
    avgAccuracy: number;
  }>;
  rankings?: {
    topAccuracy?: StudentRank[];
    worstAccuracy?: StudentRank[];
    topCorrect?: StudentRank[];
    worstCorrect?: StudentRank[];
  };
}

export interface UnitSummaryDoc {
  generatedAt?: unknown;
  unitId: string;
  unitTitle: string;
  subject?: string;
  category?: string;
  totals?: {
    totalAttempts?: number;
    uniqueUsers?: number;
    avgAccuracy?: number;
    avgTimeSec?: number;
    firstAttemptAccuracy?: number;
    retryImprovementRate?: number;
    improvementPriorityScore?: number;
  };
  hardestQuestions?: Array<{
    questionId: string;
    questionText: string;
    accuracy: number;
    total: number;
  }>;
  easiestQuestions?: Array<{
    questionId: string;
    questionText: string;
    accuracy: number;
    total: number;
  }>;
}

export interface QuestionAnalysisDoc {
  generatedAt?: unknown;
  unitId: string;
  questions: Array<{
    questionId: string;
    questionOrder?: number;
    questionText: string;
    total: number;
    correct: number;
    accuracy: number;
    difficulty: QuestionStat['difficulty'];
    firstAttemptAccuracy?: number;
    retryImprovementRate?: number;
    avgTimeSec?: number;
    discriminationIndex?: number;
    improvementPriorityScore?: number;
  }>;
}

export interface QuestionCorrelationsDoc {
  generatedAt?: unknown;
  unitId: string;
  minSupportUsers?: number;
  minCoWrongUsers?: number;
  pairs: Array<{
    questionIdA: string;
    questionIdB: string;
    questionTextA: string;
    questionTextB: string;
    phi: number;
    supportUsers?: number;
    coWrongUsers?: number;
    wrongUsersA?: number;
    wrongUsersB?: number;
    mistakeRateGivenA?: number;
    mistakeRateGivenB?: number;
    lift?: number;
    direction: CorrelationPair['direction'];
    strength: CorrelationPair['strength'];
  }>;
}

function toStudentRank(item: StudentRank): StudentRank {
  return {
    uid: item.uid,
    userName: item.userName,
    value: Number(item.value || 0),
    displayValue: item.displayValue || Number(item.value || 0).toFixed(1),
    avgTime: item.avgTime,
    rankValue: item.rankValue,
  };
}

export function toOverviewMetrics(
  overview: AnalyticsOverviewDoc | null,
  unitSummaries: UnitSummaryDoc[]
): OverviewMetrics {
  const totals = overview?.totals || {};

  return {
    totalAttempts: Number(totals.totalAttempts || 0),
    uniqueUsers: Number(totals.uniqueUsers || 0),
    avgAccuracy: Number(totals.avgAccuracy || 0),
    unitAccuracies: unitSummaries
      .map((unit) => ({
        unitId: unit.unitId,
        unitTitle: unit.unitTitle,
        accuracy: Number(unit.totals?.avgAccuracy || 0),
        totalAttempts: Number(unit.totals?.totalAttempts || 0),
      }))
      .sort((a, b) => b.totalAttempts - a.totalAttempts),
    rankings: overview?.rankings
      ? {
          topAccuracy: (overview.rankings.topAccuracy || []).map(toStudentRank),
          worstAccuracy: (overview.rankings.worstAccuracy || []).map(toStudentRank),
          topCorrect: (overview.rankings.topCorrect || []).map(toStudentRank),
          worstCorrect: (overview.rankings.worstCorrect || []).map(toStudentRank),
        }
      : undefined,
  };
}

export function toQuestionStats(docData: QuestionAnalysisDoc | null): QuestionStat[] {
  if (!docData?.questions?.length) return [];

  return docData.questions
    .map((question) => ({
      qId: question.questionId,
      questionText: question.questionText,
      total: Number(question.total || 0),
      correct: Number(question.correct || 0),
      rate: Number(question.accuracy || 0),
      difficulty: question.difficulty,
    }))
    .sort((a, b) => a.qId.localeCompare(b.qId, undefined, { numeric: true }));
}

export function toCorrelationPairs(docData: QuestionCorrelationsDoc | null): CorrelationPair[] {
  if (!docData?.pairs?.length) return [];

  return docData.pairs.map((pair, index) => ({
    qIdA: pair.questionIdA,
    qIdB: pair.questionIdB,
    qTextA: pair.questionTextA,
    qTextB: pair.questionTextB,
    indexA: index,
    indexB: index + 1,
    phi: Number(pair.phi || 0),
    supportUsers: Number(pair.supportUsers || 0),
    coWrongUsers: Number(pair.coWrongUsers || 0),
    wrongUsersA: Number(pair.wrongUsersA || 0),
    wrongUsersB: Number(pair.wrongUsersB || 0),
    mistakeRateGivenA: Number(pair.mistakeRateGivenA || 0),
    mistakeRateGivenB: Number(pair.mistakeRateGivenB || 0),
    lift: Number(pair.lift || 0),
    direction: pair.direction,
    strength: pair.strength,
  }));
}

export async function fetchAnalyticsOverview(): Promise<AnalyticsOverviewDoc | null> {
  const snap = await getDoc(doc(db, 'analytics_serving', 'current', 'overview', 'current'));
  return snap.exists() ? (snap.data() as AnalyticsOverviewDoc) : null;
}

export async function fetchUnitSummaries(): Promise<UnitSummaryDoc[]> {
  const snap = await getDocs(collection(db, 'analytics_serving', 'current', 'unit_summaries'));
  return snap.docs.map((item) => item.data() as UnitSummaryDoc);
}

export async function fetchQuestionAnalysis(unitId: string): Promise<QuestionAnalysisDoc | null> {
  const snap = await getDoc(doc(db, 'analytics_serving', 'current', 'question_analysis', unitId));
  return snap.exists() ? (snap.data() as QuestionAnalysisDoc) : null;
}

export async function fetchQuestionCorrelations(unitId: string): Promise<QuestionCorrelationsDoc | null> {
  const snap = await getDoc(doc(db, 'analytics_serving', 'current', 'question_correlations', unitId));
  return snap.exists() ? (snap.data() as QuestionCorrelationsDoc) : null;
}
