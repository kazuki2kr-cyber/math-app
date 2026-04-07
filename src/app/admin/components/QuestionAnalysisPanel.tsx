'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, PieChart, Pie } from 'recharts';
import { AlertTriangle, CheckCircle, Info, Trophy, Users, Award, Sparkles, Clock } from 'lucide-react';
import { MathDisplay } from '@/components/MathDisplay';
import type { QuestionStat, ActionSuggestion, DistributionBin, OverviewMetrics } from '@/lib/analytics';

interface QuestionAnalysisPanelProps {
  questionStats: QuestionStat[];
  distribution: DistributionBin[];
  suggestions: ActionSuggestion[];
  rankings?: OverviewMetrics['rankings'];
}

export default function QuestionAnalysisPanel({
  questionStats,
  distribution,
  suggestions,
  rankings,
}: QuestionAnalysisPanelProps) {
  const attempted = questionStats.filter((q) => q.total > 0);

  if (attempted.length === 0) {
    return (
      <div className="text-gray-500 p-12 text-center bg-white rounded-xl border border-dashed shadow-sm flex flex-col items-center justify-center space-y-4">
        <BarChart className="w-12 h-12 text-gray-300" />
        <div>
          <p className="font-bold text-gray-600">まだ回答データが十分ではありません</p>
          <p className="text-sm">少なくとも1回以上、この単元の演習が完了すると統計が表示されます。</p>
        </div>
      </div>
    );
  }

  const sortedByRate = [...attempted].sort((a, b) => b.rate - a.rate);
  const top5Q = sortedByRate.slice(0, 5);
  const worst5Q = [...attempted].sort((a, b) => a.rate - b.rate).slice(0, 5);

  const COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e'];

  // Pie chart データ（難易度分布）
  const difficultyData = [
    { name: '非常に難 (<20%)', value: attempted.filter(q => q.difficulty === 'very_hard').length },
    { name: '難 (20-40%)', value: attempted.filter(q => q.difficulty === 'hard').length },
    { name: '標準 (40-70%)', value: attempted.filter(q => q.difficulty === 'normal').length },
    { name: '易 (70-90%)', value: attempted.filter(q => q.difficulty === 'easy').length },
    { name: '非常に易 (>90%)', value: attempted.filter(q => q.difficulty === 'very_easy').length },
  ].filter(d => d.value > 0);

  const PIE_COLORS = ['#ef4444', '#f97316', '#3b82f6', '#22c55e', '#a3e635'];

  return (
    <div className="space-y-6">
      {/* 1. アクションサジェスト & 単元内ランキング (3カラム構成で固定) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <Card className={`shadow-sm border-l-4 ${suggestions.length > 0 ? 'border-l-amber-400' : 'border-l-gray-300'}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <AlertTriangle className={`w-4 h-4 ${suggestions.length > 0 ? 'text-amber-500' : 'text-gray-400'}`} />
                教員向けアクション提案
              </CardTitle>
              <CardDescription className="text-xs">
                問題の統計データから自動的に改善ポイントを検出しました
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 min-h-[100px] flex flex-col justify-center">
              {suggestions.length > 0 ? (
                suggestions.map((s, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border text-sm flex gap-3 items-start ${
                      s.type === 'warning'
                        ? 'bg-red-50 border-red-200 text-red-800'
                        : s.type === 'success'
                          ? 'bg-green-50 border-green-200 text-green-800'
                          : 'bg-blue-50 border-blue-200 text-blue-800'
                    }`}
                  >
                    <span className="text-lg flex-shrink-0 mt-0.5">{s.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-xs">{s.title}</p>
                      <p className="text-xs mt-1 opacity-85 leading-relaxed">{s.description}</p>
                      {s.fullText && (
                        <div className="mt-2 p-2 bg-white/60 rounded border border-current/10 text-gray-900 font-medium">
                           <MathDisplay math={s.fullText} className="text-xs" />
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-gray-400 flex flex-col items-center gap-2">
                  <Sparkles className="w-8 h-8 text-gray-200" />
                  <p className="text-xs font-bold">現在、特筆すべき改善点はありません</p>
                  <p className="text-[10px]">全問題が良好なバランスで解答されています。</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 正答率分布 + 難易度パイ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 leading-none">
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold text-gray-800">正答率分布</CardTitle>
              </CardHeader>
              <CardContent>
                <div style={{ width: '100%', height: 180 }}>
                  <ResponsiveContainer>
                    <BarChart data={distribution} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="range" fontSize={10} />
                      <YAxis fontSize={10} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
                        formatter={(value: any, name: any, props: any) => [`${value}問`, props.payload.label]}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
                        {distribution.map((_, idx) => (
                          <Cell key={idx} fill={COLORS[idx]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold text-gray-800">難易度構成</CardTitle>
              </CardHeader>
              <CardContent>
                <div style={{ width: '100%', height: 180 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={difficultyData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={70}
                        paddingAngle={3}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                        labelLine={false}
                        fontSize={9}
                      >
                        {difficultyData.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: any) => [`${v}問`]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* 単元内生徒ランキング (常に右側に固定) */}
        <div className="h-full">
          <Card className="shadow-sm border-indigo-100 bg-indigo-50/10 h-full flex flex-col">
            <CardHeader className="pb-3 border-b flex-shrink-0">
              <CardTitle className="text-sm font-black flex items-center gap-2">
                <Trophy className="w-4 h-4 text-indigo-500" />
                この単元の最高成績
              </CardTitle>
              <CardDescription className="text-[10px]">
                正答率順 (同率の場合はスピード順)
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 flex-1 overflow-y-auto">
              {rankings?.top5Accuracy && rankings.top5Accuracy.length > 0 ? (
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[10px] font-bold text-indigo-600 mb-2 uppercase tracking-widest flex items-center gap-1">
                      👑 TOP プレイヤー
                    </h4>
                    <div className="space-y-2">
                      {rankings.top5Accuracy.map((item, idx) => (
                        <div key={item.uid} className="flex flex-col bg-white p-2 rounded border border-indigo-50 shadow-sm transition-transform hover:scale-[1.02]">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full text-[10px] font-black ${
                                idx === 0 ? 'bg-yellow-400 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
                              }`}>
                                {idx + 1}
                              </span>
                              <span className="text-xs font-bold text-gray-700 truncate">{item.userName}</span>
                            </div>
                            <span className="text-xs font-black text-indigo-600 ml-2 whitespace-nowrap">{item.displayValue}</span>
                          </div>
                          {item.rankValue && (
                            <div className="text-[9px] text-gray-400 flex items-center gap-1 mt-1 pl-7 font-medium">
                              <Clock className="w-2 h-2" />
                              {item.rankValue}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {rankings.worst5Accuracy && rankings.worst5Accuracy.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 mb-2 uppercase tracking-widest flex items-center gap-1">
                        ⚠️ 苦戦中（低正答率 × 低速）
                      </h4>
                      <div className="space-y-1 opacity-70 bg-white/40 p-2 rounded-lg">
                        {rankings.worst5Accuracy.slice(0, 3).map((item, idx) => (
                          <div key={item.uid} className="flex items-center justify-between py-1">
                            <span className="text-[10px] text-gray-500 truncate mr-2">{item.userName}</span>
                            <div className="flex flex-col items-end">
                              <span className="text-[10px] font-bold text-gray-400 whitespace-nowrap">{item.displayValue}</span>
                              {item.rankValue && <span className="text-[8px] text-gray-300 font-medium">{item.rankValue}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-10 opacity-40">
                  <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-xs text-gray-500 font-bold">まだプレイデータが<br/>ありません</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 2. 問題ごとの詳細（Top/Worst） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-md border-t-4 border-t-green-500 bg-white group transition-all hover:shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-black text-green-700 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              正答率が良い問題 TOP 5
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            {top5Q.map((q, idx) => (
              <QuestionSimpleCard key={idx} q={q} variant="success" />
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-md border-t-4 border-t-red-500 bg-white group transition-all hover:shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-black text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              間違いが多い問題 WORST 5
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            {worst5Q.map((q, idx) => (
              <QuestionSimpleCard key={idx} q={q} variant="danger" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QuestionSimpleCard({ q, variant }: { q: QuestionStat, variant: 'success' | 'danger' }) {
  return (
    <div className={`p-3 rounded-lg border flex gap-3 items-center transition-all hover:shadow-md ${
      variant === 'success' ? 'bg-green-50/50 border-green-100' : 'bg-red-50/50 border-red-100'
    }`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm flex-shrink-0 shadow-inner ${
        variant === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}>
        {Math.round(q.rate)}%
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-1">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">
             ID: {q.qId} — {variant === 'success' ? `${q.correct} / ${q.total} 回正解` : `${q.total - q.correct} / ${q.total} 回不正解`}
          </span>
          <Award className={`w-3 h-3 ${variant === 'success' ? 'text-green-400' : 'text-red-400'}`} />
        </div>
        <div className="text-[11px] font-medium text-gray-700 line-clamp-2 leading-relaxed">
          <MathDisplay math={q.questionText} className="text-xs" />
        </div>
      </div>
    </div>
  );
}
