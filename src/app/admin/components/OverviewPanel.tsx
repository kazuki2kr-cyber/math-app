'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';
import { TrendingUp, Users, Target, BookOpen, Crown, AlertOctagon, Award, Clock, Sparkles } from 'lucide-react';
import type { OverviewMetrics, StudentRank } from '@/lib/analytics';

interface OverviewPanelProps {
  metrics: OverviewMetrics;
  scoresCount: number;
  currentSubject?: string;
}

export default function OverviewPanel({ metrics, scoresCount, currentSubject = '全教科' }: OverviewPanelProps) {
  const kpiCards = [
    {
      label: '合計正誤判定数',
      value: metrics.totalAttempts.toLocaleString(),
      sub: `全ユーザーの延べ回答数`,
      icon: <BookOpen className="w-5 h-5" />,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
    },
    {
      label: 'プレイデータ数',
      value: scoresCount.toLocaleString(),
      sub: `${currentSubject}の保存スコア数`,
      icon: <Users className="w-5 h-5" />,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
    },
    {
      label: '全体平均正答率',
      value: `${metrics.avgAccuracy.toFixed(1)}%`,
      sub: `${currentSubject}の全ユーザ平均`,
      icon: <Target className="w-5 h-5" />,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
    },
    {
      label: '分析対象単元数',
      value: metrics.unitAccuracies.length.toString(),
      sub: `${currentSubject}の収録単元`,
      icon: <TrendingUp className="w-5 h-5" />,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
      border: 'border-violet-200',
    },
  ];

  const chartData = metrics.unitAccuracies.map((u) => ({
    name: u.unitTitle.length > 10 ? u.unitTitle.slice(0, 10) + '…' : u.unitTitle,
    fullName: u.unitTitle,
    accuracy: Math.round(u.accuracy * 10) / 10,
    attempts: u.totalAttempts,
  }));

  const getBarColor = (accuracy: number) => {
    if (accuracy >= 80) return '#22c55e';
    if (accuracy >= 60) return '#84cc16';
    if (accuracy >= 40) return '#eab308';
    if (accuracy >= 20) return '#f97316';
    return '#ef4444';
  };

  const subjectLabel = currentSubject === '全教科' ? '教科横断' : currentSubject;

  return (
    <div className="space-y-6">
      {/* KPI カード */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <Card key={card.label} className={`shadow-sm border ${card.border} ${card.bg}/30`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`${card.color} ${card.bg} p-2 rounded-lg`}>
                  {card.icon}
                </span>
              </div>
              <p className="text-2xl font-black text-gray-900 tracking-tight">{card.value}</p>
              <p className="text-xs font-bold text-gray-600 mt-0.5">{card.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{card.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ランキングセクション */}
      {metrics.rankings && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* 正答率ランキング */}
          <Card className="shadow-sm border-amber-100 bg-amber-50/10">
            <CardHeader className="pb-2 border-b">
              <CardTitle className="text-sm font-black flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-500" />
                実力派：平均正答率ランキング ({subjectLabel})
              </CardTitle>
              <CardDescription className="text-[10px]">
                同率の場合は平均回答時間が短い順に表示
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-2">
                <div className="border-r p-3">
                  <h4 className="text-[10px] font-bold text-amber-600 mb-2 uppercase tracking-widest flex items-center gap-1">
                    <Crown className="w-3 h-3" /> TOP 5
                  </h4>
                  <RankingList list={metrics.rankings.top5Accuracy} type="high" showTime icon={<Clock className="w-2.5 h-2.5" />} />
                </div>
                <div className="p-3">
                  <h4 className="text-[10px] font-bold text-gray-500 mb-2 uppercase tracking-widest flex items-center gap-1">
                    <AlertOctagon className="w-3 h-3" /> 苦戦傾向
                  </h4>
                  <RankingList list={metrics.rankings.worst5Accuracy} type="low" showTime />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 正解数ランキング */}
          <Card className="shadow-sm border-blue-100 bg-blue-50/10">
            <CardHeader className="pb-2 border-b">
              <CardTitle className="text-sm font-black flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-500" />
                努力家：ベスト累計正解数 ({subjectLabel})
              </CardTitle>
              <CardDescription className="text-[10px]">
                各単元のベストスコアに基づく正解数の合計
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-2">
                <div className="border-r p-3">
                  <h4 className="text-[10px] font-bold text-blue-600 mb-2 uppercase tracking-widest flex items-center gap-1">
                    <Crown className="w-3 h-3" /> TOP 5
                  </h4>
                  <RankingList list={metrics.rankings.top5Correct} type="high" />
                </div>
                <div className="p-3">
                  <h4 className="text-[10px] font-bold text-gray-400 mb-2 uppercase tracking-widest flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> これから頑張る生徒
                  </h4>
                  <RankingList list={metrics.rankings.worst5Correct} type="low" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 単元別正答率チャート */}
      {chartData.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-gray-800 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              単元別 平均正答率 ({currentSubject})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ width: '100%', height: Math.max(chartData.length * 40, 200) }}>
              <ResponsiveContainer>
                <BarChart
                   data={chartData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} fontSize={11} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    fontSize={11}
                    tick={{ fill: '#4b5563' }}
                  />
                  <Tooltip
                    formatter={(value: any) => [`${value}%`, '正答率']}
                    labelFormatter={(label: any, payload: any) => {
                      const item = payload?.[0]?.payload;
                      return item?.fullName || label;
                    }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                  />
                  <Bar dataKey="accuracy" radius={[0, 4, 4, 0]} maxBarSize={24}>
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={getBarColor(entry.accuracy)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              ※ 全学習者の総正解数÷総回答数で算出。履歴のすべての正誤を含みます。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RankingList({ list, type, showTime = false, icon }: { list: StudentRank[], type: 'high' | 'low', showTime?: boolean, icon?: React.ReactNode }) {
  if (!list?.length) return <div className="text-[10px] text-gray-400 py-4 text-center">データなし</div>;
  
  return (
    <div className="space-y-1">
      {list.map((item, idx) => (
        <div key={item.uid} className="flex flex-col group py-1 border-b border-gray-50 last:border-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 overflow-hidden">
              <span className={`text-[9px] font-black w-3.5 h-3.5 flex items-center justify-center rounded-full ${
                type === 'high' 
                  ? (idx === 0 ? 'bg-amber-100 text-amber-700 shadow-sm' : 'bg-gray-100 text-gray-600')
                  : 'bg-gray-50 text-gray-400'
              }`}>
                {idx + 1}
              </span>
              <span className="text-[11px] font-medium text-gray-700 truncate group-hover:text-primary transition-colors">
                {item.userName}
              </span>
            </div>
            <span className={`text-[11px] font-black whitespace-nowrap ${
               type === 'high' ? 'text-gray-900' : 'text-gray-400'
            }`}>
              {item.displayValue}
            </span>
          </div>
          {item.rankValue && (
            <div className={`text-[9px] mt-0.5 flex items-center gap-1 font-medium ${type === 'high' ? 'text-amber-600/70' : 'text-gray-400/70'} pl-5`}>
              {icon}
              {item.rankValue}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
