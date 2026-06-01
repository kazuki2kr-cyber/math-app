'use client';

import React, { useMemo, useState } from 'react';
import { collection, collectionGroup, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, RefreshCw, RotateCcw, Sigma, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { db, functions } from '@/lib/firebase';
import { MathDisplay } from '@/components/MathDisplay';

type WrittenAttempt = {
  id: string;
  path: string;
  uid?: string;
  userName?: string;
  unitId?: string;
  unitTitle?: string;
  questionId?: string;
  score?: number;
  time?: number;
  date?: unknown;
  xpGain?: number;
  grading?: {
    rubricScores?: Array<{
      label?: string;
      score?: number;
      maxScore?: number;
      comment?: string;
    }>;
  };
};

type RubricSummary = {
  key: string;
  label: string;
  maxScore: number;
  count: number;
  average: number;
  standardDeviation: number;
  averageRate: number;
};

type OverallSummary = {
  count: number;
  average: number;
  standardDeviation: number;
  min: number;
  max: number;
};

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = average(values);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function formatDate(value: unknown): string {
  if (!value) return '-';
  const date = typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as any).toDate === 'function'
    ? (value as any).toDate()
    : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ja-JP');
}

function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString('ja-JP', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function buildOverallSummary(attempts: WrittenAttempt[]): OverallSummary {
  const scores = attempts.map((attempt) => toNumber(attempt.score));
  return {
    count: scores.length,
    average: average(scores),
    standardDeviation: sampleStandardDeviation(scores),
    min: scores.length ? Math.min(...scores) : 0,
    max: scores.length ? Math.max(...scores) : 0,
  };
}

function buildRubricSummary(attempts: WrittenAttempt[]): RubricSummary[] {
  const buckets = new Map<string, { label: string; maxScore: number; scores: number[] }>();

  attempts.forEach((attempt) => {
    const rubricScores = Array.isArray(attempt.grading?.rubricScores) ? attempt.grading.rubricScores : [];
    rubricScores.forEach((item, index) => {
      const label = String(item?.label || `項目${index + 1}`);
      const maxScore = Math.max(1, toNumber(item?.maxScore));
      const key = `${index}:${label}`;
      const existing = buckets.get(key) || { label, maxScore, scores: [] };
      existing.maxScore = Math.max(existing.maxScore, maxScore);
      existing.scores.push(toNumber(item?.score));
      buckets.set(key, existing);
    });
  });

  return Array.from(buckets.entries()).map(([key, bucket]) => {
    const avg = average(bucket.scores);
    return {
      key,
      label: bucket.label,
      maxScore: bucket.maxScore,
      count: bucket.scores.length,
      average: avg,
      standardDeviation: sampleStandardDeviation(bucket.scores),
      averageRate: bucket.maxScore > 0 ? (avg / bucket.maxScore) * 100 : 0,
    };
  });
}

function buildScoreDistribution(attempts: WrittenAttempt[]) {
  const bins = [
    { range: '0-19', min: 0, max: 19, count: 0 },
    { range: '20-39', min: 20, max: 39, count: 0 },
    { range: '40-59', min: 40, max: 59, count: 0 },
    { range: '60-79', min: 60, max: 79, count: 0 },
    { range: '80-100', min: 80, max: 100, count: 0 },
  ];
  attempts.forEach((attempt) => {
    const score = toNumber(attempt.score);
    const bucket = bins.find((bin) => score >= bin.min && score <= bin.max);
    if (bucket) bucket.count += 1;
  });
  return bins.map(({ range, count }) => ({ range, count }));
}

function isMathWrittenUnit(unit: any): boolean {
  if (unit?.drillType !== 'written') return false;
  const subjectText = `${unit?.subject || ''} ${unit?.baseSubject || ''}`.toLowerCase();
  return subjectText.includes('math') || subjectText.includes('数学');
}

export default function WrittenAnalyticsTab() {
  const [writtenUnits, setWrittenUnits] = useState<any[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [selectedQuestion, setSelectedQuestion] = useState<any | null>(null);
  const [attempts, setAttempts] = useState<WrittenAttempt[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [restoreXp, setRestoreXp] = useState(true);
  const [message, setMessage] = useState('');

  const selectedUnit = writtenUnits.find((unit) => unit.id === selectedUnitId) || null;
  const overallSummary = useMemo(() => buildOverallSummary(attempts), [attempts]);
  const rubricSummary = useMemo(() => buildRubricSummary(attempts), [attempts]);
  const distribution = useMemo(() => buildScoreDistribution(attempts), [attempts]);
  const sortedAttempts = useMemo(
    () => [...attempts].sort((left, right) => String(right.date || '').localeCompare(String(left.date || ''))),
    [attempts]
  );

  const loadWrittenUnits = async () => {
    setLoadingUnits(true);
    setMessage('');
    try {
      const snap = await getDocs(query(
        collection(db, 'units'),
        where('drillType', '==', 'written')
      ));
      const nextUnits = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter(isMathWrittenUnit)
        .sort((left: any, right: any) => String(left.title || left.id).localeCompare(String(right.title || right.id), 'ja'));
      setWrittenUnits(nextUnits);
      if (!selectedUnitId && nextUnits.length > 0) {
        setSelectedUnitId(nextUnits[0].id);
      }
      if (nextUnits.length === 0) {
        setSelectedUnitId('');
      }
    } catch (error: any) {
      console.error('Failed to load written units', error);
      setMessage(`記述式イベント一覧の読み込みに失敗しました: ${error.message || error}`);
    } finally {
      setLoadingUnits(false);
    }
  };

  const loadAttempts = async () => {
    if (!selectedUnitId) return;
    setLoadingAttempts(true);
    setMessage('');
    try {
      const [attemptSnap, questionSnap] = await Promise.all([
        getDocs(query(
          collectionGroup(db, 'attempts'),
          where('type', '==', 'written'),
          where('unitId', '==', selectedUnitId)
        )),
        getDocs(collection(db, 'units', selectedUnitId, 'questions')),
      ]);
      const firstQuestion = questionSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((left: any, right: any) => Number(left.order || 0) - Number(right.order || 0))[0] || null;
      setSelectedQuestion(firstQuestion);
      setAttempts(attemptSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        path: docSnap.ref.path,
        ...docSnap.data(),
      })));
    } catch (error: any) {
      console.error('Failed to load written attempts', error);
      setMessage(`記述式データの読み込みに失敗しました: ${error.message || error}`);
    } finally {
      setLoadingAttempts(false);
    }
  };

  const handleReset = async () => {
    if (!selectedUnitId || !selectedUnit) return;
    const confirmText = `${selectedUnit.title || selectedUnitId} の記述式回答データをリセットします。\n\n対象: 回答履歴、提出回数ロック、ユーザー別記述式統計${restoreXp ? '、付与XPの差し戻し' : ''}\nこの操作は元に戻せません。`;
    if (!window.confirm(confirmText)) return;
    if (!window.confirm('最終確認です。このクラス実施分の記述式回答データを削除しますか？')) return;

    setResetting(true);
    setMessage('');
    try {
      const resetFn = httpsCallable(functions, 'resetWrittenEventData');
      const result: any = await resetFn({ unitId: selectedUnitId, restoreXp });
      const data = result.data || {};
      setAttempts([]);
      setMessage(`リセットしました。削除: ${data.deletedAttempts || 0}件 / 対象ユーザー: ${data.touchedUsers || 0}人${restoreXp ? ` / 差し戻しXP: ${data.restoredXp || 0}` : ''}`);
    } catch (error: any) {
      console.error('Failed to reset written event data', error);
      setMessage(`リセットに失敗しました: ${error.message || error}`);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <BarChart3 className="h-5 w-5 text-primary" />
            記述式分析
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            記述式イベントの回答履歴から、合計点とルーブリック項目ごとの平均・標準偏差を即時計算します。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={loadWrittenUnits} disabled={loadingUnits || loadingAttempts}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loadingUnits ? 'animate-spin' : ''}`} />
            イベント一覧を読み込む
          </Button>
          <Button size="sm" onClick={loadAttempts} disabled={!selectedUnitId || loadingAttempts}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loadingAttempts ? 'animate-spin' : ''}`} />
            回答を読み込む
          </Button>
        </div>
      </div>

      {message && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${message.includes('失敗') ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>
          {message}
        </div>
      )}

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">
          記述式イベント
        </label>
        <select
          value={selectedUnitId}
          onChange={(event) => {
            setSelectedUnitId(event.target.value);
            setAttempts([]);
            setSelectedQuestion(null);
            setMessage('');
          }}
          className="w-full rounded-md border bg-white px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 md:max-w-xl"
        >
          <option value="">-- 選択してください --</option>
          {writtenUnits.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.title || unit.id}
            </option>
          ))}
        </select>
        {writtenUnits.length === 0 && (
          <p className="mt-3 text-xs text-amber-700">
            まだ記述式イベント一覧を読み込んでいません。必要なときだけ「イベント一覧を読み込む」を押してください。
          </p>
        )}
        {selectedQuestion?.question_text && (
          <div className="mt-4 rounded-lg border bg-gray-50 p-3 text-sm">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">問題文</p>
            <MathDisplay math={selectedQuestion.question_text} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard icon={<Users className="h-4 w-4" />} label="提出者数" value={`${overallSummary.count}人`} />
        <SummaryCard icon={<Sigma className="h-4 w-4" />} label="全体平均" value={`${formatNumber(overallSummary.average)}点`} />
        <SummaryCard icon={<Sigma className="h-4 w-4" />} label="全体標準偏差" value={formatNumber(overallSummary.standardDeviation)} />
        <SummaryCard label="最高 / 最低" value={`${formatNumber(overallSummary.max, 0)} / ${formatNumber(overallSummary.min, 0)}`} />
      </div>

      {attempts.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <h4 className="mb-4 text-sm font-bold text-gray-900">ルーブリック別平均点</h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rubricSummary.map((item) => ({ name: item.label, average: Number(item.average.toFixed(1)) }))} margin={{ left: -20, right: 10, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" fontSize={10} />
                    <YAxis fontSize={10} />
                    <Tooltip />
                    <Bar dataKey="average" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <h4 className="mb-4 text-sm font-bold text-gray-900">合計点分布</h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distribution} margin={{ left: -20, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="range" fontSize={10} />
                    <YAxis allowDecimals={false} fontSize={10} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <div className="border-b bg-gray-50 px-4 py-3">
              <h4 className="text-sm font-bold text-gray-900">ルーブリック別集計</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-white">
                  <tr>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500">項目</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500">満点</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500">平均</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500">得点率</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500">標準偏差</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500">件数</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rubricSummary.map((item) => (
                    <tr key={item.key}>
                      <td className="px-4 py-3 font-medium text-gray-900">{item.label}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(item.maxScore, 0)}</td>
                      <td className="px-4 py-3 text-right font-bold text-primary">{formatNumber(item.average)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(item.averageRate)}%</td>
                      <td className="px-4 py-3 text-right">{formatNumber(item.standardDeviation)}</td>
                      <td className="px-4 py-3 text-right">{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <div className="border-b bg-gray-50 px-4 py-3">
              <h4 className="text-sm font-bold text-gray-900">個別回答一覧</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-white">
                  <tr>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500">生徒</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500">合計</th>
                    {rubricSummary.map((item) => (
                      <th key={item.key} className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500">{item.label}</th>
                    ))}
                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500">提出日時</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sortedAttempts.map((attempt) => {
                    const scores = Array.isArray(attempt.grading?.rubricScores) ? attempt.grading.rubricScores : [];
                    return (
                      <tr key={attempt.path}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{attempt.userName || '名前なし'}</p>
                          <p className="text-[10px] text-gray-400">{attempt.uid || '-'}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-primary">{formatNumber(toNumber(attempt.score), 0)}</td>
                        {rubricSummary.map((item) => {
                          const score = scores.find((rubricItem, index) => `${index}:${rubricItem?.label || `項目${index + 1}`}` === item.key);
                          return (
                            <td key={item.key} className="px-4 py-3 text-right">
                              {score ? `${formatNumber(toNumber(score.score), 0)} / ${formatNumber(toNumber(score.maxScore), 0)}` : '-'}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-right text-xs text-gray-500">{formatDate(attempt.date)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed bg-white px-6 py-12 text-center text-gray-400">
          <BarChart3 className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm font-medium">まだ表示する回答データがありません</p>
          <p className="mt-1 text-xs">イベントを選択して「回答を読み込む」を押してください。</p>
        </div>
      )}

      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-bold text-red-900">記述式回答データのリセット</p>
            <p className="mt-1 text-xs text-red-700">
              選択中のイベントについて、回答履歴と提出回数ロックを削除します。次のクラス実施前に使います。
            </p>
            <label className="mt-3 flex items-center gap-2 text-xs font-medium text-red-800">
              <input
                type="checkbox"
                checked={restoreXp}
                onChange={(event) => setRestoreXp(event.target.checked)}
                className="h-4 w-4 rounded border-red-300"
              />
              記述式で付与されたXPも差し戻す
            </label>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-red-300 text-red-700 hover:bg-red-100"
            onClick={handleReset}
            disabled={!selectedUnitId || resetting}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {resetting ? 'リセット中...' : 'この記述式データをリセット'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-black text-gray-900">{value}</p>
    </div>
  );
}
