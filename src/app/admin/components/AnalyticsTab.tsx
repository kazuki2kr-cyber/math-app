'use client';

import React, { useState, useMemo } from 'react';
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
import { BookOpen } from 'lucide-react';

interface AnalyticsTabProps {
  units: any[];
  scores: any[];
  selectedUnitForStats: string;
  setSelectedUnitForStats: (unitId: string) => void;
}

type SubTab = 'overview' | 'questions' | 'correlation';

export default function AnalyticsTab({
  units,
  scores,
  selectedUnitForStats,
  setSelectedUnitForStats,
}: AnalyticsTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('overview');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // 利用可能な教科リストの抽出
  const subjects = useMemo(() => {
    const s = new Set<string>();
    units.forEach(u => {
      if (u.subject) s.add(u.subject);
      else s.add('数学'); // Default
    });
    return Array.from(s);
  }, [units]);

  // 教科フィルターに基づく単元の絞り込み
  const subjectFilteredUnits = useMemo(() => {
    if (subjectFilter === 'all') return units;
    return units.filter(u => (u.subject || '数学') === subjectFilter);
  }, [units, subjectFilter]);

  // 分野リストの抽出
  const availableCategories = useMemo(() => {
    const c = new Set<string>();
    subjectFilteredUnits.forEach(u => {
      c.add(u.category || 'その他');
    });
    return Array.from(c).sort();
  }, [subjectFilteredUnits]);

  // 分野フィルターに基づく単元の絞り込み
  const filteredUnits = useMemo(() => {
    if (categoryFilter === 'all') return subjectFilteredUnits;
    return subjectFilteredUnits.filter(u => (u.category || 'その他') === categoryFilter);
  }, [subjectFilteredUnits, categoryFilter]);

  // 教科フィルターに基づくスコアの絞り込み
  const filteredScores = useMemo(() => {
    if (subjectFilter === 'all') return scores;
    const filteredUnitIds = new Set(filteredUnits.map(u => u.id));
    return scores.filter(s => filteredUnitIds.has(s.unitId));
  }, [scores, filteredUnits, subjectFilter]);

  // 概要メトリクス計算
  const overviewMetrics: OverviewMetrics = useMemo(() => {
    const allStats: Record<string, any> = {};
    for (const unit of filteredUnits) {
      if (unit.stats) {
        allStats[unit.id] = unit.stats;
      }
    }
    const metrics = calculateOverviewFromStats(subjectFilteredUnits, allStats);
    
    // 分野別統計の計算 (OverviewPanel用)
    metrics.categoryAccuracies = calculateCategoryAccuracies(subjectFilteredUnits, allStats);

    // 生徒ランキングの計算
    metrics.rankings = calculateStudentRankings(filteredScores, filteredUnits);
    
    return metrics;
  }, [subjectFilteredUnits, filteredScores, filteredUnits]);

  // 選択中の単元データ
  const selectedUnitData = useMemo(
    () => units.find((u: any) => u.id === selectedUnitForStats),
    [units, selectedUnitForStats]
  );

  // 選択中の単元の問題統計
  const questionStats = useMemo(() => {
    if (!selectedUnitData?.stats || !selectedUnitData?.questions) return [];
    return buildQuestionStats(selectedUnitData.questions, selectedUnitData.stats);
  }, [selectedUnitData]);

  // 選択中の単元のランキング
  const unitRankings = useMemo(() => {
    if (!selectedUnitForStats) return undefined;
    const unitScores = scores.filter(s => s.unitId === selectedUnitForStats);
    // ランキング計算にはすべての単元情報を渡す（名前解決のため）
    return calculateStudentRankings(unitScores, units);
  }, [scores, selectedUnitForStats, units]);

  // 正答率分布
  const distribution = useMemo(() => calculateAccuracyDistribution(questionStats), [questionStats]);

  // アクションサジェスト
  const suggestions = useMemo(
    () => generateActionSuggestions(questionStats, []),
    [questionStats]
  );

  const subTabs: { key: SubTab; label: string; icon: string }[] = [
    { key: 'overview', label: '概要', icon: '📊' },
    { key: 'questions', label: '問題分析', icon: '📝' },
    { key: 'correlation', label: '相関分析', icon: '🔗' },
  ];

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
        </div>
      </div>

      {/* 概要パネル */}
      {activeSubTab === 'overview' && (
        <OverviewPanel 
          metrics={overviewMetrics} 
          scoresCount={filteredScores.length} 
          currentSubject={subjectFilter === 'all' ? '全教科' : subjectFilter}
        />
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
