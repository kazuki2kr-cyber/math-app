'use client';

import React, { useMemo, useState } from 'react';
import { FileText, Printer, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  fetchPublicAnalyticsReportOverview,
  fetchPublicAnalyticsReportTrends,
  fetchPublicAnalyticsReportUnits,
  type PublicAnalyticsReportOverviewDoc,
  type PublicAnalyticsReportTrendDoc,
  type PublicAnalyticsReportUnitDoc,
} from '@/lib/analyticsServing';

function formatGeneratedAt(value: unknown): string {
  if (!value) return '未生成';
  if (typeof value === 'string') return new Date(value).toLocaleString('ja-JP');
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const timestamp = value as { toDate?: () => Date };
    if (typeof timestamp.toDate === 'function') {
      return timestamp.toDate().toLocaleString('ja-JP');
    }
  }
  return '未生成';
}

function formatNumber(value: unknown, digits = 0): string {
  const parsed = Number(value || 0);
  return parsed.toLocaleString('ja-JP', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatPercent(value: unknown): string {
  return `${formatNumber(value, 1)}%`;
}

function formatStudyTime(seconds: unknown): string {
  const hours = Number(seconds || 0) / 3600;
  if (hours >= 10) return `${formatNumber(hours, 0)}時間`;
  return `${formatNumber(hours, 1)}時間`;
}

export default function PublicAnalyticsReportPanel() {
  const [overview, setOverview] = useState<PublicAnalyticsReportOverviewDoc | null>(null);
  const [trends, setTrends] = useState<PublicAnalyticsReportTrendDoc | null>(null);
  const [units, setUnits] = useState<PublicAnalyticsReportUnitDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const publishable = overview?.privacy?.publishable !== false;
  const thresholds = overview?.privacy?.thresholds;

  const topPriorityUnits = useMemo(
    () =>
      [...units]
        .sort(
          (left, right) =>
            Number(right.totals?.improvementPriorityScore || 0) -
            Number(left.totals?.improvementPriorityScore || 0)
        )
        .slice(0, 6),
    [units]
  );

  const strugglingQuestions = useMemo(
    () =>
      units
        .flatMap((unit) =>
          (unit.reviewQuestions || []).map((question) => ({
            ...question,
            unitTitle: unit.unitTitle,
          }))
        )
        .sort((left, right) => Number(right.stumbleRate || 0) - Number(left.stumbleRate || 0))
        .slice(0, 8),
    [units]
  );

  const maxTrendAttempts = useMemo(
    () => Math.max(1, ...(trends?.days || []).map((day) => Number(day.totalAttempts || 0))),
    [trends?.days]
  );

  const loadReport = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [overviewDoc, trendDoc, unitDocs] = await Promise.all([
        fetchPublicAnalyticsReportOverview(),
        fetchPublicAnalyticsReportTrends(),
        fetchPublicAnalyticsReportUnits(),
      ]);

      setOverview(overviewDoc);
      setTrends(trendDoc);
      setUnits(unitDocs);
      setLoaded(true);
    } catch (error) {
      console.error('Failed to load public analytics report docs', error);
      setMessage('レポート用データの読み込みに失敗しました。集計を再実行してから確認してください。');
    } finally {
      setLoading(false);
    }
  };

  const printReport = () => {
    document.body.classList.add('printing-student-report');

    const cleanup = () => {
      document.body.classList.remove('printing-student-report');
      window.removeEventListener('afterprint', cleanup);
    };

    window.addEventListener('afterprint', cleanup);
    window.setTimeout(() => {
      window.print();
      window.setTimeout(cleanup, 800);
    }, 50);
  };

  if (!loaded) {
    return (
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-emerald-50 p-2 text-emerald-700">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">生徒配布用レポート</p>
              <p className="mt-1 text-sm text-muted-foreground">
                匿名化済みの集計だけを読み込み、印刷またはPDF保存できる形式で表示します。
              </p>
            </div>
          </div>
          <Button onClick={loadReport} disabled={loading} size="sm">
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                読み込み中
              </span>
            ) : (
              <>
                <RefreshCw className="mr-1.5 h-4 w-4" />
                レポートを読み込む
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
        <p className="font-semibold">レポート用データがまだありません</p>
        <p className="mt-1 text-sm">集計を再実行すると `public_analytics_serving` に匿名化済みレポートが生成されます。</p>
        <Button className="mt-4" variant="outline" size="sm" onClick={loadReport} disabled={loading}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          再読み込み
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="student-report-no-print flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-semibold text-gray-900">生徒配布用レポート</p>
          <p className="mt-1 text-sm text-muted-foreground">
            管理者だけが出力できます。本文には個人名・uid・メールアドレスを含めません。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={loadReport} disabled={loading}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            再読み込み
          </Button>
          <Button size="sm" onClick={printReport} disabled={!publishable}>
            <Printer className="mr-1.5 h-4 w-4" />
            印刷 / PDF
          </Button>
        </div>
      </div>

      {message && (
        <p className="student-report-no-print rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </p>
      )}

      {!publishable && (
        <div className="student-report-no-print rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          公開基準を満たす人数に達していないため、このレポートは出力できません。
        </div>
      )}

      <section className="student-report-print rounded-lg border bg-white p-6 shadow-sm print:shadow-none">
        <header className="border-b pb-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Formix Learning Report</p>
              <h2 className="mt-1 text-2xl font-black text-gray-950">みんなの学習レポート</h2>
              <p className="mt-2 text-sm text-gray-600">生成日時: {formatGeneratedAt(overview.generatedAt)}</p>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <ShieldCheck className="h-4 w-4" />
              k匿名化済み
            </div>
          </div>
        </header>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <ReportMetric label="参加人数" value={`${formatNumber(overview.totals?.uniqueUsers)}人`} />
          <ReportMetric label="演習回数" value={formatNumber(overview.totals?.totalAttempts)} />
          <ReportMetric label="平均正答率" value={formatPercent(overview.totals?.avgAccuracy)} />
          <ReportMetric label="学習時間" value={formatStudyTime(overview.totals?.totalStudyTimeSec)} />
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section>
            <h3 className="text-base font-bold text-gray-900">最近30日の学習量</h3>
            <div className="mt-3 space-y-2">
              {(trends?.days || []).slice(-14).map((day) => (
                <div key={day.date} className="grid grid-cols-[84px_1fr_72px] items-center gap-3 text-sm">
                  <span className="text-gray-600">{day.date}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{ width: `${Math.max(5, (Number(day.totalAttempts || 0) / maxTrendAttempts) * 100)}%` }}
                    />
                  </div>
                  <span className="text-right tabular-nums text-gray-700">{formatNumber(day.totalAttempts)}回</span>
                </div>
              ))}
              {!(trends?.days || []).length && (
                <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">公開基準を満たす日別データがありません。</p>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-base font-bold text-gray-900">重点的に復習したい単元</h3>
            <div className="mt-3 overflow-hidden rounded-md border">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2">単元</th>
                    <th className="px-3 py-2 text-right">正答率</th>
                    <th className="px-3 py-2 text-right">改善度</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {topPriorityUnits.map((unit) => (
                    <tr key={unit.unitId}>
                      <td className="px-3 py-2 font-medium text-gray-900">{unit.unitTitle}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPercent(unit.totals?.avgAccuracy)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(unit.totals?.improvementPriorityScore, 1)}
                      </td>
                    </tr>
                  ))}
                  {!topPriorityUnits.length && (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-gray-500">公開基準を満たす単元がありません。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="mt-6">
          <h3 className="text-base font-bold text-gray-900">みんなが苦戦中の問題</h3>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {strugglingQuestions.map((question) => (
              <div key={`${question.unitTitle}-${question.questionId}`} className="rounded-md border p-3">
                <p className="text-xs font-semibold text-gray-500">{question.unitTitle}</p>
                <p className="mt-1 line-clamp-2 text-sm font-medium text-gray-900">{question.questionText}</p>
                <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
                  <span>つまずき率 {formatPercent(question.stumbleRate)}</span>
                  <span>回答 {formatNumber(question.total)}件</span>
                </div>
              </div>
            ))}
            {!strugglingQuestions.length && (
              <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">公開基準を満たす問題データがありません。</p>
            )}
          </div>
        </section>

        <footer className="mt-6 border-t pt-3 text-xs text-gray-500">
          個人を特定できる情報は含めていません。単元は {thresholds?.unitMinUsers || 5} 人以上、問題は{' '}
          {thresholds?.questionMinUsers || 5} 人以上かつ {thresholds?.questionMinAttempts || 10} 回以上のデータだけを掲載しています。
        </footer>
      </section>
    </div>
  );
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-gray-50 px-3 py-3">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-black text-gray-950">{value}</p>
    </div>
  );
}
