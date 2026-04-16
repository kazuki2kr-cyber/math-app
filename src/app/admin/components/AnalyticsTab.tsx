'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import OverviewPanel from './OverviewPanel';
import QuestionAnalysisPanel from './QuestionAnalysisPanel';
import SmartCorrelationPanel from './SmartCorrelationPanel';
import {
  buildQuestionStats,
  calculateOverviewFromStats,
  calculateCategoryAccuracies,
  calculateAccuracyDistribution,
  generateActionSuggestions,
  calculateStudentRankings,
  type OverviewMetrics,
} from '@/lib/analytics';
import { BookOpen, RotateCcw, BarChart2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AnalyticsTabProps {
  units: any[];
  scores: any[];
  globalStats: any;
  selectedUnitForStats: string;
  setSelectedUnitForStats: (unitId: string) => void;
  onResetAllData: () => Promise<void>;
  onLoadData: () => Promise<void>;
}

type SubTab = 'overview' | 'questions' | 'correlation';

export default function AnalyticsTab({
  units,
  scores,
  globalStats,
  selectedUnitForStats,
  setSelectedUnitForStats,
  onResetAllData,
  onLoadData,
}: AnalyticsTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('overview');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [unitQuestionsData, setUnitQuestionsData] = useState<any[]>([]);
  const [dataRequested, setDataRequested] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const dataAvailable = units.length > 0 || scores.length > 0;

  const handleLoadData = async () => {
    setLoadingData(true);
    setDataRequested(true);
    try {
      await onLoadData();
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (!selectedUnitForStats) {
      setUnitQuestionsData([]);
      return;
    }

    const fetchQuestions = async () => {
      try {
        const qSnap = await getDocs(query(collection(db, 'units', selectedUnitForStats, 'questions'), orderBy('order', 'asc')));
        const qList = qSnap.docs.map(doc => doc.data());
        setUnitQuestionsData(qList);
      } catch (e) {
        console.error("Failed to load questions", e);
      }
    };
    fetchQuestions();
  }, [selectedUnitForStats]);

  const subjects = useMemo(() => {
    const s = new Set<string>();
    units.forEach(u => {
      if (u.subject) s.add(u.subject);
      else s.add('数学');
    });
    return Array.from(s);
  }, [units]);

  const subjectFilteredUnits = useMemo(() => {
    if (subjectFilter === 'all') return units;
    return units.filter(u => (u.subject || '数学') === subjectFilter);
  }, [units, subjectFilter]);

  const availableCategories = useMemo(() => {
    const c = new Set<string>();
    subjectFilteredUnits.forEach(u => {
      c.add(u.category || 'その他');
    });
    return Array.from(c).sort();
  }, [subjectFilteredUnits]);

  const filteredUnits = useMemo(() => {
    if (categoryFilter === 'all') return subjectFilteredUnits;
    return subjectFilteredUnits.filter(u => (u.category || 'その他') === categoryFilter);
  }, [subjectFilteredUnits, categoryFilter]);

  const filteredScores = useMemo(() => {
    if (subjectFilter === 'all') return scores;
    const filteredUnitIds = new Set(filteredUnits.map(u => u.id));
    return scores.filter(s => filteredUnitIds.has(s.unitId));
  }, [scores, filteredUnits, subjectFilter]);

  // Bug fix: build two separate stats maps
  // - allStats: only for filteredUnits (respects both subject + category filters)
  // - subjectAllStats: for subjectFilteredUnits (only subject filter, used for category breakdown)
  const overviewMetrics: OverviewMetrics = useMemo(() => {
    const allStats: Record<string, any> = {};
    for (const unit of filteredUnits) {
      if (unit.stats) allStats[unit.id] = unit.stats;
    }

    const subjectAllStats: Record<string, any> = {};
    for (const unit of subjectFilteredUnits) {
      if (unit.stats) subjectAllStats[unit.id] = unit.stats;
    }

    // Bug fix: pass filteredUnits (not subjectFilteredUnits) to get accurate filtered totals
    const metrics = calculateOverviewFromStats(filteredUnits, allStats);
    metrics.categoryAccuracies = calculateCategoryAccuracies(subjectFilteredUnits, subjectAllStats);
    metrics.rankings = calculateStudentRankings(filteredScores, filteredUnits);

    return metrics;
  }, [subjectFilteredUnits, filteredScores, filteredUnits]);

  const selectedUnitData = useMemo(
    () => units.find((u: any) => u.id === selectedUnitForStats),
    [units, selectedUnitForStats]
  );

  const questionStats = useMemo(() => {
    if (!selectedUnitData?.stats || unitQuestionsData.length === 0) return [];
    return buildQuestionStats(unitQuestionsData, selectedUnitData.stats);
  }, [selectedUnitData, unitQuestionsData]);

  const unitRankings = useMemo(() => {
    if (!selectedUnitForStats) return undefined;
    const unitScores = scores.filter(s => s.unitId === selectedUnitForStats);
    return calculateStudentRankings(unitScores, units);
  }, [scores, selectedUnitForStats, units]);

  const distribution = useMemo(() => calculateAccuracyDistribution(questionStats), [questionStats]);

  const suggestions = useMemo(
    () => generateActionSuggestions(questionStats, []),
    [questionStats]
  );

  const subTabs: { key: SubTab; label: string; icon: string }[] = [
    { key: 'overview', label: '概要', icon: '📊' },
    { key: 'questions', label: '問題分析', icon: '📝' },
    { key: 'correlation', label: '相関分析', icon: '🔗' },
  ];

  // Bug fix: use filtered count when a filter is active, globalStats only for unfiltered view
  const isFiltered = subjectFilter !== 'all' || categoryFilter !== 'all';
  const displayScoresCount = isFiltered ? filteredScores.length : (globalStats?.totalDrills ?? filteredScores.length);

  if (!dataAvailable && !dataRequested) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-500">
        <BarChart2 className="w-12 h-12 text-gray-300" />
        <p className="text-sm font-medium">データを読み込んで分析を開始します</p>
        <p className="text-xs text-muted-foreground">単元データ・演習データを取得します（初回のみ時間がかかる場合があります）</p>
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
        <span className="text-sm font-medium">データを読み込み中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-4">
      {/* 教科フィルター & サブタブ */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {subTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveSubTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                activeSubTab === tab.key
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span className="mr-1.5">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 教科フィルター */}
          <div className="flex items-center gap-2 bg-white border px-3 py-1.5 rounded-lg shadow-sm">
            <BookOpen className="w-4 h-4 text-gray-400" />
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">教科:</span>
            <select
              value={subjectFilter}
              onChange={(e) => {
                setSubjectFilter(e.target.value);
                setCategoryFilter('all');
              }}
              className="text-sm font-medium bg-transparent outline-none border-none focus:ring-0 cursor-pointer min-w-[80px]"
            >
              <option value="all">すべて</option>
              {subjects.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* 分野フィルター */}
          <div className="flex items-center gap-2 bg-white border px-3 py-1.5 rounded-lg shadow-sm">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">分野:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="text-sm font-medium bg-transparent outline-none border-none focus:ring-0 cursor-pointer min-w-[120px]"
            >
              <option value="all">すべての分野</option>
              {availableCategories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <Button variant="outline" size="sm" onClick={handleLoadData} disabled={loadingData} className="text-xs">
            再読み込み
          </Button>
        </div>
      </div>

      {/* 概要パネル */}
      {activeSubTab === 'overview' && (
        <>
          <OverviewPanel
            metrics={overviewMetrics}
            scoresCount={displayScoresCount}
            currentSubject={subjectFilter === 'all' ? '全教科' : subjectFilter}
          />
          {/* データリセットボタン */}
          <div className="mt-6 pt-6 border-t border-dashed border-gray-300">
            <Button
              variant="outline"
              className="text-xs text-red-500 border-red-300 hover:bg-red-50"
              onClick={onResetAllData}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              全プレイデータをリセット
            </Button>
            <p className="text-[10px] text-muted-foreground mt-1">※ ユーザーのXP・スコア・ランキング・統計がすべて0になります</p>
          </div>
        </>
      )}

      {/* 問題分析パネル */}
      {activeSubTab === 'questions' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <label className="text-sm font-bold text-gray-700 mb-2 block">分析する単元を選択:</label>
            <select
              value={selectedUnitForStats}
              onChange={(e) => setSelectedUnitForStats(e.target.value)}
              className="w-full md:w-auto border rounded-md px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">-- 選択してください --</option>
              {filteredUnits.length > 0 ? (
                filteredUnits.map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.title || u.id}
                  </option>
                ))
              ) : (
                <option disabled>該当する単元がありません</option>
              )}
            </select>
          </div>

          {selectedUnitForStats && selectedUnitData && (
            <QuestionAnalysisPanel
              questionStats={questionStats}
              distribution={distribution}
              suggestions={suggestions}
              rankings={unitRankings}
            />
          )}
        </div>
      )}

      {/* 相関分析パネル */}
      {activeSubTab === 'correlation' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <label className="text-sm font-bold text-gray-700 mb-2 block">分析する単元を選択:</label>
            <select
              value={selectedUnitForStats}
              onChange={(e) => setSelectedUnitForStats(e.target.value)}
              className="w-full md:w-auto border rounded-md px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">-- 選択してください --</option>
              {filteredUnits.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.title || u.id}
                </option>
              ))}
            </select>
          </div>

          {selectedUnitForStats && selectedUnitData && (
            <SmartCorrelationPanel
              unitId={selectedUnitForStats}
              questions={selectedUnitData.questions || []}
            />
          )}
        </div>
      )}
    </div>
  );
}
