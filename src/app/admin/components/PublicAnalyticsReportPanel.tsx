'use client';

import React, { useMemo, useState } from 'react';
import { FileText, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MathDisplay } from '@/components/MathDisplay';
import {
  fetchPublicAnalyticsReportCategories,
  fetchPublicAnalyticsReportOverview,
  fetchPublicAnalyticsReportUnits,
  type PublicAnalyticsReportCategoryDoc,
  type PublicAnalyticsReportOverviewDoc,
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

function toReportDate(value: unknown): Date {
  if (typeof value === 'string') return new Date(value);
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const timestamp = value as { toDate?: () => Date };
    if (typeof timestamp.toDate === 'function') return timestamp.toDate();
  }
  return new Date();
}

function formatFilenameTimestamp(value: unknown): string {
  const date = toReportDate(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('');
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '').slice(0, 48) || '全分野';
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
  const minutes = Number(seconds || 0) / 60;
  if (minutes >= 600) return `${formatNumber(minutes / 60, 0)}時間`;
  if (minutes >= 60) return `${formatNumber(minutes / 60, 1)}時間`;
  return `${formatNumber(minutes, 0)}分`;
}

function weightedAverage(
  units: PublicAnalyticsReportUnitDoc[],
  selector: (unit: PublicAnalyticsReportUnitDoc) => number
): number {
  const totalWeight = units.reduce((sum, unit) => sum + Number(unit.totals?.totalAttempts || 0), 0);
  if (!totalWeight) return 0;
  return units.reduce((sum, unit) => sum + selector(unit) * Number(unit.totals?.totalAttempts || 0), 0) / totalWeight;
}

export default function PublicAnalyticsReportPanel() {
  const [overview, setOverview] = useState<PublicAnalyticsReportOverviewDoc | null>(null);
  const [categories, setCategories] = useState<PublicAnalyticsReportCategoryDoc[]>([]);
  const [units, setUnits] = useState<PublicAnalyticsReportUnitDoc[]>([]);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState('all');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const selectedCategory = categories.find((category) => category.categoryKey === selectedCategoryKey) || null;
  const thresholds = overview?.privacy?.thresholds;
  const publishable = overview?.privacy?.publishable !== false;

  const filteredUnits = useMemo(() => {
    if (selectedCategoryKey === 'all') return units;
    return units.filter((unit) => unit.category === selectedCategory?.category);
  }, [selectedCategory?.category, selectedCategoryKey, units]);

  const activeTotals = selectedCategory?.totals || overview?.totals || {};
  const activeTitle = selectedCategory ? `${selectedCategory.category} レポート` : '全分野レポート';
  const reportScopeName = selectedCategory?.category || '全分野';
  const metricScopeLabel = selectedCategory
    ? `${selectedCategory.category}のBigQuery集計対象全体`
    : 'BigQuery集計対象全体';

  const featuredUnits = useMemo(
    () =>
      [...filteredUnits]
        .sort(
          (left, right) =>
            Number(right.totals?.improvementPriorityScore || 0) -
            Number(left.totals?.improvementPriorityScore || 0)
        )
        .slice(0, 4),
    [filteredUnits]
  );

  const strugglingQuestions = useMemo(
    () =>
      filteredUnits
        .flatMap((unit) =>
          (unit.reviewQuestions || []).map((question) => ({
            ...question,
            unitTitle: unit.unitTitle,
          }))
        )
        .sort((left, right) => Number(right.stumbleRate || 0) - Number(left.stumbleRate || 0))
        .slice(0, 4),
    [filteredUnits]
  );

  const coMistakes = useMemo(
    () =>
      filteredUnits
        .flatMap((unit) =>
          (unit.strongCoMistakes || []).map((pair) => ({
            ...pair,
            unitTitle: unit.unitTitle,
          }))
        )
        .sort((left, right) => Number(right.coWrongUsers || 0) - Number(left.coWrongUsers || 0))
        .slice(0, 2),
    [filteredUnits]
  );

  const firstAttemptAccuracy = weightedAverage(
    filteredUnits,
    (unit) => Number(unit.totals?.firstAttemptAccuracy || 0)
  );
  const retryImprovementRate = weightedAverage(
    filteredUnits,
    (unit) => Number(unit.totals?.retryImprovementRate || 0)
  );
  const avgTimeSec = weightedAverage(filteredUnits, (unit) => Number(unit.totals?.avgTimeSec || 0));
  const activeInsights = selectedCategory?.insights || overview?.insights || {
    initialStumbleRate: Math.max(0, 100 - firstAttemptAccuracy),
    retryImprovementRate,
    persistentStruggleQuestions: strugglingQuestions.filter((question) => Number(question.stumbleRate || 0) >= 40).length,
    coMistakePairs: coMistakes.length,
  };
  const quartileWideQuestions = activeInsights.quartileQuestions?.wide || [];
  const quartileNarrowQuestions = activeInsights.quartileQuestions?.narrow || [];

  const loadReport = async (categoryKey = selectedCategoryKey) => {
    setLoading(true);
    setMessage(null);
    try {
      const [overviewDoc, categoryDocs, unitDocs] = await Promise.all([
        fetchPublicAnalyticsReportOverview(),
        fetchPublicAnalyticsReportCategories(),
        fetchPublicAnalyticsReportUnits(),
      ]);

      setOverview(overviewDoc);
      setCategories(categoryDocs.sort((left, right) => left.category.localeCompare(right.category, 'ja')));
      setUnits(unitDocs);

      setLoaded(true);
    } catch (error) {
      console.error('Failed to load public analytics report docs', error);
      setMessage('レポート用データの読み込みに失敗しました。集計を再実行してから確認してください。');
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryChange = (categoryKey: string) => {
    setSelectedCategoryKey(categoryKey);
  };

  const printReport = () => {
    const previousTitle = document.title;
    const filename = `${formatFilenameTimestamp(overview?.generatedAt)}_Formix_${sanitizeFileSegment(reportScopeName)}_分析レポート`;

    document.body.classList.add('printing-student-report');
    document.title = filename;

    const cleanup = () => {
      document.body.classList.remove('printing-student-report');
      document.title = previousTitle;
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
                匿名化済みの集計だけを読み込み、分野別に印刷またはPDF保存できます。
              </p>
            </div>
          </div>
          <Button onClick={() => loadReport()} disabled={loading} size="sm">
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
        <Button className="mt-4" variant="outline" size="sm" onClick={() => loadReport()} disabled={loading}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          再読み込み
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="student-report-no-print flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-semibold text-gray-900">生徒配布用レポート</p>
          <p className="mt-1 text-sm text-muted-foreground">
            管理者だけが出力できます。本文には個人名・uid・メールアドレスを含めません。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-gray-600" htmlFor="report-category">
            分野
          </label>
          <select
            id="report-category"
            value={selectedCategoryKey}
            onChange={(event) => handleCategoryChange(event.target.value)}
            className="h-9 rounded-md border bg-white px-3 text-sm"
          >
            <option value="all">全分野</option>
            {categories.map((category) => (
              <option key={category.categoryKey} value={category.categoryKey}>
                {category.category}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => loadReport()} disabled={loading}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            再読み込み
          </Button>
          <Button size="sm" onClick={printReport} disabled={!publishable || loading}>
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

      <section className="student-report-print report-a4-sheet rounded-lg border bg-white text-gray-950 shadow-sm print:shadow-none">
        <header className="report-header">
          <div>
            <p className="report-kicker">Formix Learning Report</p>
            <h2>{activeTitle}</h2>
            <p className="report-muted">生成日時: {formatGeneratedAt(overview.generatedAt)}</p>
          </div>
        </header>

        <p className="report-scope-note">上段の主要指標は{metricScopeLabel}です。</p>
        <div className="report-metrics">
          <ReportMetric label="参加人数" value={`${formatNumber(activeTotals.uniqueUsers)}人`} note="重複を除いた人数" />
          <ReportMetric label="演習回数" value={formatNumber(activeTotals.totalAttempts)} note="提出された演習" />
          <ReportMetric label="平均正答率" value={formatPercent(activeTotals.avgAccuracy)} note="正答数 ÷ 解答数" />
          <ReportMetric label="学習時間" value={formatStudyTime(activeTotals.totalStudyTimeSec)} note="演習時間の合計" />
          <ReportMetric label="初回正答率" value={formatPercent(firstAttemptAccuracy)} note="最初の挑戦で正解" />
          <ReportMetric label="再挑戦改善" value={formatPercent(retryImprovementRate)} note="再挑戦後の伸び" />
        </div>

        <div className="report-summary-strip">
          <div>
            <span>初回つまずき</span>
            <b>{formatPercent(activeInsights.initialStumbleRate)}</b>
          </div>
          <div>
            <span>再挑戦後の変化</span>
            <b>{formatPercent(activeInsights.retryImprovementRate)}</b>
          </div>
          <div>
            <span>苦戦が残る問題</span>
            <b>{formatNumber(activeInsights.persistentStruggleQuestions)}問</b>
          </div>
          <div>
            <span>共通つまずき</span>
            <b>{formatNumber(activeInsights.coMistakePairs)}組</b>
          </div>
        </div>

        <div className="report-grid">
          <section className="report-panel report-quartiles">
            <div className="report-section-title">
              <h3>差がつきやすい問題</h3>
              <p>四分位範囲が大きい/小さい問題</p>
            </div>
            <div className="report-quartile-grid">
              <div>
                <b>差が大きい</b>
                {quartileWideQuestions.map((question) => (
                  <article key={`wide-${question.unitId}-${question.questionId}`}>
                    <p>{question.unitTitle}</p>
                    <MathDisplay math={question.questionText} className="text-[9px] leading-tight" />
                    <span>IQR {formatNumber(question.iqr, 1)} / 正答率 {formatPercent(question.accuracy)}</span>
                  </article>
                ))}
                {!quartileWideQuestions.length && <p className="report-empty">公開基準を満たす四分位データがありません。</p>}
              </div>
              <div>
                <b>差が小さい</b>
                {quartileNarrowQuestions.map((question) => (
                  <article key={`narrow-${question.unitId}-${question.questionId}`}>
                    <p>{question.unitTitle}</p>
                    <MathDisplay math={question.questionText} className="text-[9px] leading-tight" />
                    <span>IQR {formatNumber(question.iqr, 1)} / 正答率 {formatPercent(question.accuracy)}</span>
                  </article>
                ))}
                {!quartileNarrowQuestions.length && <p className="report-empty">公開基準を満たす四分位データがありません。</p>}
              </div>
            </div>
          </section>

          <section className="report-panel">
            <div className="report-section-title">
              <h3>復習優先の単元</h3>
              <p>低正答率かつ演習が多い単元</p>
            </div>
            <table className="report-table">
              <thead>
                <tr>
                  <th>単元</th>
                  <th>正答率</th>
                  <th>改善度</th>
                </tr>
              </thead>
              <tbody>
                {featuredUnits.map((unit) => (
                  <tr key={unit.unitId}>
                    <td>{unit.unitTitle}</td>
                    <td>{formatPercent(unit.totals?.avgAccuracy)}</td>
                    <td>{formatNumber(unit.totals?.improvementPriorityScore, 1)}</td>
                  </tr>
                ))}
                {!featuredUnits.length && (
                  <tr>
                    <td colSpan={3}>公開基準を満たす単元がありません。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>

        <section className="report-panel report-questions">
          <div className="report-section-title">
            <h3>みんなが苦戦中の問題</h3>
            <p>つまずき率 = 100% - 正答率</p>
          </div>
          <div className="report-question-list">
            {strugglingQuestions.map((question, index) => (
              <article key={`${question.unitTitle}-${question.questionId}`}>
                <b className="report-question-rank">{index + 1}</b>
                <div className="report-question-body">
                  <p>{question.unitTitle}</p>
                  <div className="report-question-math">
                    <MathDisplay math={question.questionText} className="text-[10px] leading-snug" />
                  </div>
                </div>
                <div className="report-question-score" aria-label={`つまずき率 ${formatPercent(question.stumbleRate)}`}>
                  <strong>{formatPercent(question.stumbleRate)}</strong>
                  <span>回答 {formatNumber(question.total)}件</span>
                  <i style={{ width: `${Math.min(100, Math.max(0, question.stumbleRate * 100))}%` }} />
                </div>
              </article>
            ))}
            {!strugglingQuestions.length && <p className="report-empty">公開基準を満たす問題データがありません。</p>}
          </div>
        </section>

        <div className="report-bottom-grid">
          <section className="report-panel">
            <div className="report-section-title">
              <h3>誤答のつながり</h3>
              <p>一緒に間違えやすい問題ペア</p>
            </div>
            <div className="report-pairs">
              {coMistakes.map((pair) => (
                <article key={`${pair.unitTitle}-${pair.questionIdA}-${pair.questionIdB}`}>
                  <p>{pair.unitTitle}</p>
                  <div>
                    <MathDisplay math={pair.questionTextA} className="text-[9px] leading-tight" />
                    <span>+</span>
                    <MathDisplay math={pair.questionTextB} className="text-[9px] leading-tight" />
                  </div>
                  <b>同時誤答 {formatNumber(pair.coWrongUsers)}人</b>
                </article>
              ))}
              {!coMistakes.length && <p className="report-empty">公開基準を満たす誤答ペアがありません。</p>}
            </div>
          </section>

          <section className="report-panel report-glossary">
            <div className="report-section-title">
              <h3>用語の見方</h3>
              <p>数字の読み取り方</p>
            </div>
            <dl>
              <dt>改善度</dt>
              <dd>正答率の低さと演習回数を合わせた、復習優先度の目安です。</dd>
              <dt>つまずき率</dt>
              <dd>その問題で不正解になった割合です。高いほど苦戦しています。</dd>
              <dt>再挑戦変化</dt>
              <dd>初回と比べて、再挑戦後の正答率がどれだけ変わったかを示します。</dd>
              <dt>初回つまずき</dt>
              <dd>最初の挑戦で不正解になった割合です。学び始めの理解の引っかかりを示します。</dd>
              <dt>共通つまずき</dt>
              <dd>同じ人たちが一緒に間違えやすい問題の組み合わせです。</dd>
              <dt>平均時間</dt>
              <dd>この範囲の1演習あたり平均時間は約 {formatNumber(avgTimeSec, 0)} 秒です。</dd>
            </dl>
          </section>
        </div>

        <footer className="report-footer">
          単元は{thresholds?.unitMinUsers || 5}人以上、問題は{thresholds?.questionMinUsers || 5}人以上かつ
          {thresholds?.questionMinAttempts || 10}回以上の回答があったものだけをデータとして掲載しています。
        </footer>
      </section>
    </div>
  );
}

function ReportMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="report-metric">
      <p>{label}</p>
      <b>{value}</b>
      <span>{note}</span>
    </div>
  );
}
