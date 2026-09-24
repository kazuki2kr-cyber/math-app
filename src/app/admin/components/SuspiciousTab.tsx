'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react';

type ReviewStatus = 'unreviewed' | 'monitoring' | 'dismissed' | 'confirmed';

type IntegrityEvent = {
  id: string;
  uid?: string;
  unitId?: string;
  unitTitle?: string;
  riskScore?: number;
  severity?: 'low' | 'medium' | 'high';
  reasons?: string[];
  createdAt?: unknown;
  timestamp?: unknown;
  metrics?: {
    timeSec?: number;
    answeredCount?: number;
    correctCount?: number;
    accuracy?: number;
    averageSecondsPerQuestion?: number;
    rapidSubmissionSec?: number | null;
  };
};

type IntegritySummary = {
  id?: string;
  uid: string;
  actorKey?: string;
  displayName?: string;
  flaggedAttemptCount?: number;
  newEventCount?: number;
  riskPointsTotal?: number;
  signalCounts?: Record<string, number>;
  lastRiskScore?: number;
  lastSeverity?: 'low' | 'medium' | 'high';
  lastReasons?: string[];
  lastUnitId?: string;
  lastUnitTitle?: string;
  lastFlaggedAt?: unknown;
  totalAttemptsAtLastFlag?: number;
  reviewStatus?: ReviewStatus;
  legacy?: boolean;
  legacyEvents?: IntegrityEvent[];
};

interface SuspiciousTabProps {
  summaries: IntegritySummary[];
  eventsByUid: Record<string, IntegrityEvent[]>;
  scores: any[];
  suspiciousActivities: any[];
  loading: boolean;
  loadingUid: string | null;
  onLoadEvents: (uid: string) => Promise<void>;
  onSetReviewStatus: (uid: string, status: ReviewStatus) => Promise<void>;
  onSetUnitForStats: (unitId: string) => void;
  onSwitchToAnalytics: () => void;
  onRefresh: () => void;
}

const STATUS_LABELS: Record<ReviewStatus, string> = {
  unreviewed: '未確認',
  monitoring: '監視中',
  dismissed: '問題なし',
  confirmed: '要対応',
};

const SIGNAL_LABELS: Record<string, string> = {
  very_fast_answers: '極端な高速解答',
  fast_perfect_run: '短時間の全問正解',
  rapid_repeat_submission: '短時間の連続提出',
  invalid_question_ids: '存在しない問題ID',
};

function timestampToMillis(value: unknown): number {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }
  const parsed = new Date(value as string | number | Date).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTimestamp(value: unknown): string {
  const millis = timestampToMillis(value);
  return millis > 0 ? new Date(millis).toLocaleString('ja-JP') : '—';
}

function legacyDisplayName(value: unknown, uid: string): string {
  const name = typeof value === 'string' ? value.trim().slice(0, 80) : '';
  return name && !name.includes('@') ? name : `利用者 ${uid.slice(0, 8)}`;
}

function buildLegacySummaries(scores: any[], suspiciousActivities: any[]): IntegritySummary[] {
  const groups = new Map<string, IntegritySummary>();

  const addEvent = (uid: string, displayName: string, event: IntegrityEvent, riskScore: number) => {
    const current = groups.get(uid) || {
      uid,
      actorKey: event.uid ? `usr_${event.uid.slice(0, 8)}` : uid,
      displayName,
      flaggedAttemptCount: 0,
      newEventCount: 0,
      riskPointsTotal: 0,
      lastRiskScore: 0,
      lastSeverity: 'low' as const,
      lastReasons: [],
      reviewStatus: 'unreviewed' as const,
      legacy: true,
      legacyEvents: [],
    };
    const eventMillis = timestampToMillis(event.createdAt || event.timestamp);
    const currentMillis = timestampToMillis(current.lastFlaggedAt);
    current.flaggedAttemptCount = Number(current.flaggedAttemptCount || 0) + 1;
    current.riskPointsTotal = Number(current.riskPointsTotal || 0) + riskScore;
    current.legacyEvents = [...(current.legacyEvents || []), event];
    if (eventMillis >= currentMillis) {
      current.lastFlaggedAt = event.createdAt || event.timestamp;
      current.lastRiskScore = riskScore;
      current.lastSeverity = riskScore >= 80 ? 'high' : riskScore >= 60 ? 'medium' : 'low';
      current.lastReasons = event.reasons || [];
      current.lastUnitId = event.unitId;
      current.lastUnitTitle = event.unitTitle;
    }
    groups.set(uid, current);
  };

  suspiciousActivities.forEach((activity) => {
    const sourceUid = String(activity.uid || `unknown_${activity.userName || activity.id}`);
    addEvent(`legacy:${sourceUid}`, legacyDisplayName(activity.userName, sourceUid), {
      id: activity.id,
      uid: sourceUid,
      unitId: activity.unitId,
      reasons: activity.reasons || ['サーバー検知'],
      riskScore: 80,
      severity: 'high',
      timestamp: activity.timestamp,
      metrics: activity.details,
    }, 80);
  });

  scores
    .filter((score) => score.time != null && score.time > 0 && !score.ignoreFraud)
    .forEach((score) => {
      const answeredCount = score.answeredCount || (Array.isArray(score.details) ? score.details.length : 10);
      const averageSeconds = score.time / Math.max(1, answeredCount);
      if (averageSeconds > 5) return;
      const sourceUid = String(score.uid || `unknown_${score.userName || score.docId}`);
      const riskScore = averageSeconds <= 3 ? 60 : 40;
      addEvent(`legacy:${sourceUid}`, legacyDisplayName(score.userName, sourceUid), {
        id: score.docId,
        uid: sourceUid,
        unitId: score.unitId,
        unitTitle: score.unitTitle,
        reasons: [`平均解答時間が${averageSeconds.toFixed(1)}秒/問（旧形式）`],
        riskScore,
        severity: averageSeconds <= 3 ? 'medium' : 'low',
        createdAt: score.date,
        metrics: {
          timeSec: score.time,
          answeredCount,
          averageSecondsPerQuestion: averageSeconds,
        },
      }, riskScore);
    });

  return [...groups.values()].sort(
    (left, right) => timestampToMillis(right.lastFlaggedAt) - timestampToMillis(left.lastFlaggedAt),
  );
}

function RiskBadge({ summary }: { summary: IntegritySummary }) {
  const severity = summary.lastSeverity || 'low';
  const styles = severity === 'high'
    ? 'bg-red-100 text-red-700 border-red-200'
    : severity === 'medium'
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-sky-100 text-sky-700 border-sky-200';
  const label = severity === 'high' ? '高' : severity === 'medium' ? '中' : '低';

  return (
    <span className={`inline-flex min-w-12 justify-center rounded-full border px-2 py-1 text-xs font-bold ${styles}`}>
      {label} {summary.lastRiskScore ?? 0}
    </span>
  );
}

export default function SuspiciousTab({
  summaries,
  eventsByUid,
  scores,
  suspiciousActivities,
  loading,
  loadingUid,
  onLoadEvents,
  onSetReviewStatus,
  onSetUnitForStats,
  onSwitchToAnalytics,
  onRefresh,
}: SuspiciousTabProps) {
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | 'all'>('unreviewed');
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const legacySummaries = useMemo(
    () => buildLegacySummaries(scores, suspiciousActivities),
    [scores, suspiciousActivities],
  );
  const rows = useMemo(() => (
    [...summaries, ...legacySummaries].sort(
      (left, right) => timestampToMillis(right.lastFlaggedAt) - timestampToMillis(left.lastFlaggedAt),
    )
  ), [summaries, legacySummaries]);
  const filteredRows = rows.filter((summary) => {
    const status = summary.reviewStatus || 'unreviewed';
    return statusFilter === 'all' || status === statusFilter;
  });

  const toggleDetails = async (summary: IntegritySummary) => {
    if (expandedUid === summary.uid) {
      setExpandedUid(null);
      return;
    }
    setExpandedUid(summary.uid);
    if (!summary.legacy && !eventsByUid[summary.uid]) {
      await onLoadEvents(summary.uid);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <ShieldCheck className="h-5 w-5 text-primary" />
            ユーザー別インテグリティ確認
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            速度だけで不正を確定せず、複数の兆候をレビューしてください。自動的な利用停止は行いません。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ReviewStatus | 'all')}
            className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium shadow-sm"
          >
            <option value="unreviewed">未確認</option>
            <option value="monitoring">監視中</option>
            <option value="confirmed">要対応</option>
            <option value="dismissed">問題なし</option>
            <option value="all">すべて</option>
          </select>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="shadow-sm">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 更新
          </Button>
        </div>
      </div>

      {legacySummaries.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          新しい検知サマリーと、旧形式の未移行履歴を併記しています。
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="w-10 px-3 py-4" aria-label="詳細" />
                <th className="px-3 py-4 text-[10px] font-bold uppercase tracking-wider">利用者</th>
                <th className="px-3 py-4 text-center text-[10px] font-bold uppercase tracking-wider">リスク</th>
                <th className="px-3 py-4 text-[10px] font-bold uppercase tracking-wider">検知サンプル</th>
                <th className="px-3 py-4 text-[10px] font-bold uppercase tracking-wider">主な兆候</th>
                <th className="px-3 py-4 text-[10px] font-bold uppercase tracking-wider">最終検知</th>
                <th className="px-3 py-4 text-[10px] font-bold uppercase tracking-wider">レビュー</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredRows.map((summary) => {
                const isExpanded = expandedUid === summary.uid;
                const events = summary.legacy ? summary.legacyEvents || [] : eventsByUid[summary.uid] || [];
                const signalEntries = Object.entries(summary.signalCounts || {})
                  .filter(([, count]) => Number(count) > 0)
                  .sort((left, right) => Number(right[1]) - Number(left[1]));

                return (
                  <React.Fragment key={summary.uid}>
                    <tr className="hover:bg-slate-50/70">
                      <td className="px-3 py-4 text-center">
                        <button
                          type="button"
                          className="rounded p-1 text-slate-500 hover:bg-slate-100"
                          onClick={() => void toggleDetails(summary)}
                          aria-label={isExpanded ? '詳細を閉じる' : '詳細を開く'}
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-bold text-slate-900">{summary.displayName || '不明なユーザー'}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">{summary.actorKey || `usr_${summary.uid.slice(0, 8)}`}</p>
                      </td>
                      <td className="px-3 py-4 text-center"><RiskBadge summary={summary} /></td>
                      <td className="px-3 py-4">
                        <p className="font-mono text-base font-bold text-slate-900">
                          {Number(summary.flaggedAttemptCount || 0)}件
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {summary.totalAttemptsAtLastFlag
                            ? `累計演習 ${summary.totalAttemptsAtLastFlag}件時点`
                            : summary.legacy ? '旧形式の直近取得範囲' : '15分間隔の検知記録'}
                        </p>
                        {Number(summary.newEventCount || 0) > 0 && (
                          <span className="mt-1 inline-flex rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                            新着 {summary.newEventCount}件
                          </span>
                        )}
                      </td>
                      <td className="max-w-xs px-3 py-4">
                        {signalEntries.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {signalEntries.slice(0, 3).map(([code, count]) => (
                              <span key={code} className="rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-700">
                                {SIGNAL_LABELS[code] || code} {count}件
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-600">{(summary.lastReasons || []).join('、') || '詳細を確認してください'}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 font-mono text-[10px] text-slate-500">
                        {formatTimestamp(summary.lastFlaggedAt)}
                        {summary.lastUnitId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-1 block h-6 px-1 text-[10px]"
                            onClick={() => {
                              onSetUnitForStats(summary.lastUnitId!);
                              onSwitchToAnalytics();
                            }}
                          >
                            {summary.lastUnitTitle || summary.lastUnitId}を分析
                          </Button>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        {summary.legacy ? (
                          <span className="text-[10px] text-amber-700">旧形式・参照のみ</span>
                        ) : (
                          <select
                            value={summary.reviewStatus || 'unreviewed'}
                            onChange={(event) => void onSetReviewStatus(summary.uid, event.target.value as ReviewStatus)}
                            disabled={loading}
                            className="rounded-md border bg-white px-2 py-1.5 text-xs font-medium"
                          >
                            {Object.entries(STATUS_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-slate-50/70">
                        <td colSpan={7} className="px-6 py-4">
                          {loadingUid === summary.uid ? (
                            <p className="text-center text-xs text-slate-500">詳細を読み込み中...</p>
                          ) : events.length === 0 ? (
                            <p className="text-center text-xs text-slate-500">保持期間内の詳細イベントはありません。</p>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-xs font-bold text-slate-700">最新の検知イベント（最大20件）</p>
                              {events.map((event) => (
                                <div key={event.id} className="grid gap-3 rounded-lg border bg-white p-3 md:grid-cols-[120px_1fr_180px]">
                                  <div>
                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700">
                                      <AlertTriangle className="h-3.5 w-3.5" /> リスク {event.riskScore ?? '—'}
                                    </span>
                                    <p className="mt-1 font-mono text-[10px] text-slate-400">
                                      {formatTimestamp(event.createdAt || event.timestamp)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-slate-800">{(event.reasons || []).join('、')}</p>
                                    <p className="mt-1 text-[10px] text-slate-500">
                                      {event.unitTitle || event.unitId || '単元不明'}
                                    </p>
                                  </div>
                                  <div className="font-mono text-[10px] text-slate-600">
                                    {event.metrics?.averageSecondsPerQuestion != null && (
                                      <p>{event.metrics.averageSecondsPerQuestion.toFixed(1)}秒/問</p>
                                    )}
                                    {event.metrics?.answeredCount != null && (
                                      <p>{event.metrics.correctCount ?? '—'} / {event.metrics.answeredCount}問正解</p>
                                    )}
                                    {event.metrics?.rapidSubmissionSec != null && (
                                      <p>前回から {event.metrics.rapidSubmissionSec}秒</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">
                    該当するユーザーはいません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
