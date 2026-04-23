'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { BarChart2, BookOpen, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { functions } from '@/lib/firebase';
import OverviewPanel from './OverviewPanel';
import QuestionAnalysisPanel from './QuestionAnalysisPanel';
import SmartCorrelationPanel from './SmartCorrelationPanel';
import {
  calculateAccuracyDistribution,
  calculateCategoryAccuracies,
  generateActionSuggestions,
  type OverviewMetrics,
} from '@/lib/analytics';
import {
  fetchAnalyticsOverview,
  fetchQuestionAnalysis,
  fetchQuestionCorrelations,
  fetchUnitSummaries,
  toCorrelationPairs,
  toOverviewMetrics,
  toQuestionStats,
  type AnalyticsOverviewDoc,
  type QuestionAnalysisDoc,
  type QuestionCorrelationsDoc,
  type UnitSummaryDoc,
} from '@/lib/analyticsServing';

interface AnalyticsTabProps {
  units: any[];
  scores: any[];
  globalStats: any;
  selectedUnitForStats: string;
  setSelectedUnitForStats: (unitId: string) => void;
  onResetAllData: () => Promise<void>;
  onLoadData: () => Promise<void>;
  autoLoad?: boolean;
}

type SubTab = 'overview' | 'questions' | 'correlation';

function formatGeneratedAt(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return new Date(value).toLocaleString('ja-JP');
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as any).toDate === 'function') {
    return (value as any).toDate().toLocaleString('ja-JP');
  }
  return null;
}

export default function AnalyticsTab({
  selectedUnitForStats,
  setSelectedUnitForStats,
  onResetAllData,
  autoLoad = false,
}: AnalyticsTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(autoLoad ? 'questions' : 'overview');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [dataRequested, setDataRequested] = useState(autoLoad);
  const [loadingData, setLoadingData] = useState(false);
  const [servingOverview, setServingOverview] = useState<AnalyticsOverviewDoc | null>(null);
  const [unitSummaries, setUnitSummaries] = useState<UnitSummaryDoc[]>([]);
  const [questionAnalysis, setQuestionAnalysis] = useState<QuestionAnalysisDoc | null>(null);
  const [questionCorrelations, setQuestionCorrelations] = useState<QuestionCorrelationsDoc | null>(null);
  const [aggregationRunning, setAggregationRunning] = useState(false);
  const [opsMessage, setOpsMessage] = useState<string | null>(null);

  const hasServingData = !!servingOverview || unitSummaries.length > 0;

  const filteredUnitSummaries = useMemo(() => {
    return unitSummaries.filter((unit) => {
      const matchesSubject = subjectFilter === 'all' || (unit.subject || '数学') === subjectFilter;
      const matchesCategory = categoryFilter === 'all' || (unit.category || 'その他') === categoryFilter;
      return matchesSubject && matchesCategory;
    });
  }, [categoryFilter, subjectFilter, unitSummaries]);

  const subjects = useMemo(() => {
    const subjectSet = new Set<string>();
    unitSummaries.forEach((unit) => subjectSet.add(unit.subject || '数学'));
    return Array.from(subjectSet).sort();
  }, [unitSummaries]);

  const availableCategories = useMemo(() => {
    const categorySet = new Set<string>();
    unitSummaries
      .filter((unit) => subjectFilter === 'all' || (unit.subject || '数学') === subjectFilter)
      .forEach((unit) => categorySet.add(unit.category || 'その他'));
    return Array.from(categorySet).sort();
  }, [subjectFilter, unitSummaries]);

  const overviewMetrics: OverviewMetrics = useMemo(() => {
    const metrics = toOverviewMetrics(servingOverview, filteredUnitSummaries);
    metrics.categoryAccuracies = calculateCategoryAccuraciesFromSummaries(filteredUnitSummaries);
    return metrics;
  }, [filteredUnitSummaries, servingOverview]);

  const questionStats = useMemo(() => toQuestionStats(questionAnalysis), [questionAnalysis]);
  const correlationPairs = useMemo(() => toCorrelationPairs(questionCorrelations), [questionCorrelations]);
  const distribution = useMemo(() => calculateAccuracyDistribution(questionStats), [questionStats]);
  const suggestions = useMemo(
    () => generateActionSuggestions(questionStats, correlationPairs),
    [correlationPairs, questionStats]
  );

  const selectedUnitSummary = useMemo(
    () => filteredUnitSummaries.find((unit) => unit.unitId === selectedUnitForStats) || null,
    [filteredUnitSummaries, selectedUnitForStats]
  );

  const unitSelectionOptions = filteredUnitSummaries.map((unit) => ({
    id: unit.unitId,
    title: unit.unitTitle || unit.unitId,
  }));

  const generatedAtLabel = formatGeneratedAt(
    questionCorrelations?.generatedAt || questionAnalysis?.generatedAt || servingOverview?.generatedAt
  );
  const aggregationCallable = useMemo(
    () => httpsCallable(functions, 'runAnalyticsAggregation'),
    []
  );

  const handleLoadData = async () => {
    setLoadingData(true);
    setDataRequested(true);
    try {
      const [overview, summaries] = await Promise.all([
        fetchAnalyticsOverview(),
        fetchUnitSummaries(),
      ]);

      setServingOverview(overview);
      setUnitSummaries(summaries);

      if (!selectedUnitForStats && summaries.length > 0) {
        setSelectedUnitForStats(summaries[0].unitId);
      }
    } finally {
      setLoadingData(false);
    }
  };

  /* const handleBackfill = async () => {
    setBackfillRunning(true);
    setOpsMessage(null);

    try {
      let cursor: string | null = null;
      let processed = 0;
      let written = 0;
      let skippedExisting = 0;
      let skippedInvalid = 0;
      let skippedMissingUnit = 0;
      let hasMore = false;

      do {
        const result: { data: BackfillAnalyticsResult } = await backfillCallable({
          batchSize: 200,
          cursor,
          overwriteExisting: false,
          dryRun: false,
        });
        const data: BackfillAnalyticsResult = result.data;

        processed += Number(data.processed || 0);
        written += Number(data.written || 0);
        skippedExisting += Number(data.skippedExisting || 0);
        skippedInvalid += Number(data.skippedInvalid || 0);
        skippedMissingUnit += Number(data.skippedMissingUnit || 0);
        hasMore = data.hasMore === true;
        cursor = data.nextCursor || null;
      } while (hasMore);

      setOpsMessage(
        `backfill が完了しました。processed=${processed}, written=${written}, skippedExisting=${skippedExisting}, skippedInvalid=${skippedInvalid}, skippedMissingUnit=${skippedMissingUnit}。BigQuery 同期後に再集計を実行してください。`
      );
    } catch (error) {
      console.error('Failed to backfill analytics events', error);
      setOpsMessage('backfill の実行に失敗しました。Functions ログを確認してください。');
    } finally {
      setBackfillRunning(false);
    }
  }; */

  const handleRunAggregation = async () => {
    setAggregationRunning(true);
    setOpsMessage(null);

    try {
      await aggregationCallable({});
      await handleLoadData();
      setOpsMessage('集計を再実行しました。最新データを読み込み済みです。');
    } catch (error) {
      console.error('Failed to run analytics aggregation', error);
      setOpsMessage('集計の再実行に失敗しました。Functions ログを確認してください。');
    } finally {
      setAggregationRunning(false);
    }
  };

  useEffect(() => {
    if (autoLoad && !dataRequested) {
      void handleLoadData();
    }
  }, [autoLoad, dataRequested]);

  useEffect(() => {
    if (!dataRequested || !selectedUnitForStats || !hasServingData) return;

    let cancelled = false;

    const loadUnitDocs = async () => {
      try {
        const [analysisDoc, correlationsDoc] = await Promise.all([
          fetchQuestionAnalysis(selectedUnitForStats),
          fetchQuestionCorrelations(selectedUnitForStats),
        ]);

        if (!cancelled) {
          setQuestionAnalysis(analysisDoc);
          setQuestionCorrelations(correlationsDoc);
        }
      } catch (error) {
        console.error('Failed to load serving docs for unit analytics', error);
        if (!cancelled) {
          setQuestionAnalysis(null);
          setQuestionCorrelations(null);
        }
      }
    };

    void loadUnitDocs();

    return () => {
      cancelled = true;
    };
  }, [dataRequested, hasServingData, selectedUnitForStats]);

  if (!hasServingData && !dataRequested) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-500">
        <BarChart2 className="w-12 h-12 text-gray-300" />
        <p className="text-sm font-medium">分析は BigQuery の事前集計データだけを参照します</p>
        <p className="text-xs text-muted-foreground">管理画面から raw Firestore を直接走査しない構成に切り替えています。</p>
        <Button onClick={handleLoadData} disabled={loadingData} className="mt-2">
          {loadingData ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              読み込み中...
            </span>
          ) : (
            '表示'
          )}
        </Button>
      </div>
    );
  }

  if (loadingData) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-gray-500">
        <span className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
        <span className="text-sm font-medium">分析データを読み込み中...</span>
      </div>
    );
  }

  if (!hasServingData) {
    return (
      <div className="rounded-xl border border-dashed bg-amber-50 p-6 text-amber-900">
        <p className="font-semibold">まだ集計済みデータがありません</p>
        <p className="text-sm mt-2">Extension の同期と日次集計が完了すると、管理画面の分析は `analytics_serving` だけで表示されます。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {[
            { key: 'overview', label: '概要' },
            { key: 'questions', label: '問題分析' },
            { key: 'correlation', label: '相関分析' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveSubTab(tab.key as SubTab)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                activeSubTab === tab.key
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-white border px-3 py-1.5 rounded-lg shadow-sm">
            <BookOpen className="w-4 h-4 text-gray-400" />
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">教科</span>
            <select
              value={subjectFilter}
              onChange={(event) => {
                setSubjectFilter(event.target.value);
                setCategoryFilter('all');
              }}
              className="text-sm font-medium bg-transparent outline-none border-none focus:ring-0 cursor-pointer min-w-[80px]"
            >
              <option value="all">すべて</option>
              {subjects.map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 bg-white border px-3 py-1.5 rounded-lg shadow-sm">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">分類</span>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="text-sm font-medium bg-transparent outline-none border-none focus:ring-0 cursor-pointer min-w-[120px]"
            >
              <option value="all">すべて</option>
              {availableCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <Button variant="outline" size="sm" onClick={handleLoadData} disabled={loadingData} className="text-xs">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            再読み込み
          </Button>
        </div>
      </div>

      <AnalyticsOpsPanel
        aggregationRunning={aggregationRunning}
        opsMessage={opsMessage}
        onRunAggregation={handleRunAggregation}
      />

      <div className="rounded-xl border px-4 py-3 text-sm bg-blue-50 border-blue-200 text-blue-900">
        BigQuery の事前集計結果を優先し、管理画面は `analytics_serving` のみを参照します。`attempts` や `stats` の直接走査は行いません。
      </div>

      <AnalyticsHighlights overview={servingOverview} />

      {activeSubTab === 'overview' && (
        <>
          <OverviewPanel
            metrics={overviewMetrics}
            scoresCount={Number(servingOverview?.totals?.totalAttempts || 0)}
            currentSubject={subjectFilter === 'all' ? '全教科' : subjectFilter}
          />
          <div className="mt-6 pt-6 border-t border-dashed border-gray-300">
            <Button
              variant="outline"
              className="text-xs text-red-500 border-red-300 hover:bg-red-50"
              onClick={onResetAllData}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              全プレイデータをリセット
            </Button>
            <p className="text-[10px] text-muted-foreground mt-1">XP、スコア、ランキング、統計が初期化されます。</p>
          </div>
        </>
      )}

      {activeSubTab === 'questions' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <label className="text-sm font-bold text-gray-700 mb-2 block">分析する単元を選択</label>
            <select
              value={selectedUnitForStats}
              onChange={(event) => setSelectedUnitForStats(event.target.value)}
              className="w-full md:w-auto border rounded-md px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">-- 選択してください --</option>
              {unitSelectionOptions.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.title}
                </option>
              ))}
            </select>
            {selectedUnitSummary?.totals && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-gray-100 px-3 py-1">初回正答率 {Number(selectedUnitSummary.totals.firstAttemptAccuracy || 0).toFixed(1)}%</span>
                <span className="rounded-full bg-gray-100 px-3 py-1">再挑戦改善率 {Number(selectedUnitSummary.totals.retryImprovementRate || 0).toFixed(1)}%</span>
                <span className="rounded-full bg-gray-100 px-3 py-1">平均時間 {Number(selectedUnitSummary.totals.avgTimeSec || 0).toFixed(1)}秒</span>
                <span className="rounded-full bg-gray-100 px-3 py-1">改善優先度 {Number(selectedUnitSummary.totals.improvementPriorityScore || 0).toFixed(1)}</span>
              </div>
            )}
          </div>

          {selectedUnitForStats && (
            <QuestionAnalysisPanel
              questionStats={questionStats}
              distribution={distribution}
              suggestions={suggestions}
              rankings={overviewMetrics.rankings}
            />
          )}
        </div>
      )}

      {activeSubTab === 'correlation' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <label className="text-sm font-bold text-gray-700 mb-2 block">分析する単元を選択</label>
            <select
              value={selectedUnitForStats}
              onChange={(event) => setSelectedUnitForStats(event.target.value)}
              className="w-full md:w-auto border rounded-md px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">-- 選択してください --</option>
              {unitSelectionOptions.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.title}
                </option>
              ))}
            </select>
          </div>

          {selectedUnitForStats && (
            <SmartCorrelationPanel
              pairs={correlationPairs}
              generatedAtLabel={generatedAtLabel}
              minSupportUsers={questionCorrelations?.minSupportUsers}
            />
          )}
        </div>
      )}
    </div>
  );
}

function calculateCategoryAccuraciesFromSummaries(
  summaries: UnitSummaryDoc[]
): OverviewMetrics['categoryAccuracies'] {
  return summaries
    .reduce<Array<{ category: string; accuracy: number; totalAttempts: number }>>((accumulator, unit) => {
      const category = unit.category || 'その他';
      const totalAttempts = Number(unit.totals?.totalAttempts || 0);
      const accuracy = Number(unit.totals?.avgAccuracy || 0);
      const existing = accumulator.find((item) => item.category === category);

      if (!existing) {
        accumulator.push({ category, accuracy, totalAttempts });
        return accumulator;
      }

      const combinedAttempts = existing.totalAttempts + totalAttempts;
      existing.accuracy =
        combinedAttempts === 0
          ? 0
          : ((existing.accuracy * existing.totalAttempts) + (accuracy * totalAttempts)) / combinedAttempts;
      existing.totalAttempts = combinedAttempts;
      return accumulator;
    }, [])
    .sort((left, right) => right.totalAttempts - left.totalAttempts);
}

function AnalyticsOpsPanel({
  aggregationRunning,
  opsMessage,
  onRunAggregation,
}: {
  aggregationRunning: boolean;
  opsMessage: string | null;
  onRunAggregation: () => Promise<void>;
}) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">分析データ運用</p>
          <p className="mt-1 text-xs text-muted-foreground">
            過去 attempts の backfill と、BigQuery 同期後の再集計をここから実行できます。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={onRunAggregation}
            disabled={aggregationRunning}
            className="text-xs"
          >
            {aggregationRunning ? '再集計中...' : '集計を再実行'}
          </Button>
        </div>
      </div>
      {opsMessage && (
        <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          {opsMessage}
        </p>
      )}
    </div>
  );
}

function AnalyticsHighlights({ overview }: { overview: AnalyticsOverviewDoc | null }) {
  const totals = overview?.totals;
  if (!totals) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">稼働人数</p>
        <p className="mt-2 text-2xl font-black text-gray-900">{Number(totals.dau || 0).toLocaleString()}</p>
        <p className="text-[11px] text-muted-foreground mt-1">DAU / WAU {Number(totals.wau || 0).toLocaleString()} / MAU {Number(totals.mau || 0).toLocaleString()}</p>
      </div>
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">学習量</p>
        <p className="mt-2 text-2xl font-black text-gray-900">{Number(totals.totalStudyTimeSec || 0).toLocaleString()}</p>
        <p className="text-[11px] text-muted-foreground mt-1">総学習時間(秒) / 1人平均 {Number(totals.avgAttemptsPerUser || 0).toFixed(1)} attempt</p>
      </div>
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">初回理解</p>
        <p className="mt-2 text-2xl font-black text-gray-900">{Number(totals.firstAttemptAccuracy || 0).toFixed(1)}%</p>
        <p className="text-[11px] text-muted-foreground mt-1">再挑戦改善率 {Number(totals.retryImprovementRate || 0).toFixed(1)}%</p>
      </div>
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">要注意</p>
        <p className="mt-2 text-2xl font-black text-gray-900">{Number(totals.atRiskUsers || 0).toLocaleString()}</p>
        <p className="text-[11px] text-muted-foreground mt-1">直近で正答率が低い生徒数</p>
      </div>
    </div>
  );
}
