'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import {
  ArrowLeft,
  BarChart3,
  BookOpenCheck,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Gauge,
  Loader2,
  RotateCcw,
  Target,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { getMathDashboardUnits, type DashboardUnit } from '@/lib/dashboardUnits';
import {
  buildLearningProgressReport,
  getLearningProgressReadiness,
  type LearningProgressUnitSource,
  type LearningStatus,
} from '@/lib/learningProgress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeSettingsButton } from '@/components/ThemeSettingsButton';
import { LearningAdvice } from '@/components/LearningAdvice';

interface ProgressUnit extends DashboardUnit, LearningProgressUnitSource {
  id: string;
  title: string;
}

type StatusFilter = 'all' | LearningStatus;
type SortOption = 'recommendation' | 'accuracy' | 'recent' | 'attempts';

const UNITS_CACHE_KEY = 'math_units_cache_v4';
const UNITS_CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000;

const STATUS_STYLES: Record<LearningStatus, string> = {
  unstarted: 'border-slate-200 bg-slate-50 text-slate-600',
  insufficient: 'border-blue-200 bg-blue-50 text-blue-700',
  review: 'border-red-200 bg-red-50 text-red-700',
  almost: 'border-amber-200 bg-amber-50 text-amber-800',
  mastered: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'review', label: '復習優先' },
  { value: 'almost', label: 'あと少し' },
  { value: 'insufficient', label: 'データ不足' },
  { value: 'mastered', label: '定着' },
  { value: 'unstarted', label: '未着手' },
];

function readCachedUnits(): ProgressUnit[] | null {
  try {
    const cached = localStorage.getItem(UNITS_CACHE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as { timestamp?: number; data?: ProgressUnit[] };
    if (
      typeof parsed.timestamp !== 'number'
      || Date.now() - parsed.timestamp >= UNITS_CACHE_EXPIRY_MS
      || !Array.isArray(parsed.data)
    ) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

async function loadProgressUnits(): Promise<ProgressUnit[]> {
  const cached = readCachedUnits();
  if (cached) return getMathDashboardUnits(cached);

  const snapshot = await getDocs(collection(db, 'units'));
  const units = snapshot.docs.map((unitDoc) => ({
    id: unitDoc.id,
    ...unitDoc.data(),
  } as ProgressUnit));
  try {
    localStorage.setItem(UNITS_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: units }));
  } catch {
    // The report still works when local storage is unavailable or full.
  }
  return getMathDashboardUnits(units);
}

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}分`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return '記録なし';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '記録なし';
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(date);
}

export default function LearningProgressPage() {
  const { user } = useAuth();
  const [units, setUnits] = useState<ProgressUnit[]>([]);
  const [userData, setUserData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all');
  const [sortOption, setSortOption] = useState<SortOption>('recommendation');

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    let cancelled = false;

    async function loadReportData() {
      setLoading(true);
      setError('');
      try {
        const [userSnapshot, progressUnits] = await Promise.all([
          getDoc(doc(db, 'users', uid)),
          loadProgressUnits(),
        ]);
        if (cancelled) return;
        setUnits(progressUnits);
        setUserData(userSnapshot.exists() ? userSnapshot.data() : {});
      } catch (loadError) {
        console.error('Failed to load learning progress:', loadError);
        if (!cancelled) setError('学習記録を読み込めませんでした。通信環境を確認して、もう一度お試しください。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadReportData();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const report = useMemo(
    () => buildLearningProgressReport(units, userData),
    [units, userData],
  );
  const readiness = getLearningProgressReadiness(report);

  const filteredUnits = useMemo(() => {
    const result = report.units.filter((unit) => (
      (selectedCategory === 'all' || unit.category === selectedCategory)
      && (selectedStatus === 'all' || unit.status === selectedStatus)
    ));

    return [...result].sort((left, right) => {
      if (sortOption === 'accuracy') return (right.accuracy ?? -1) - (left.accuracy ?? -1);
      if (sortOption === 'recent') {
        return Date.parse(right.lastAttemptAt || '1970-01-01') - Date.parse(left.lastAttemptAt || '1970-01-01');
      }
      if (sortOption === 'attempts') return right.allTimeAttempts - left.allTimeAttempts;
      return right.priority - left.priority || left.title.localeCompare(right.title, 'ja');
    });
  }, [report.units, selectedCategory, selectedStatus, sortOption]);

  const activeDays = report.daily.filter((day) => day.attempts > 0).length;
  const recentStudyTime = report.daily.reduce((total, day) => total + day.studyTimeSec, 0);
  const maxDailyStudyTime = Math.max(1, ...report.daily.map((day) => day.studyTimeSec));

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F8FAEB]" aria-busy="true">
        <div className="flex items-center gap-3 font-bold text-primary">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
          学習記録をまとめています
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F8FAEB] px-4">
        <div role="alert" className="max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-black text-red-800">学習記録を読み込めませんでした</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{error}</p>
          <Link href="/" className="mt-5 inline-flex items-center font-bold text-primary hover:underline">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            ダッシュボードへ戻る
          </Link>
        </div>
      </main>
    );
  }

  if (!readiness.ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F8FAEB] px-4">
        <div className="max-w-md rounded-2xl border border-primary/15 bg-white p-6 text-center shadow-sm">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-black text-slate-900">学習記録を蓄積しています</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">十分な記録が集まると、ダッシュボードに「学習の振り返り」が表示されます。</p>
          <Link href="/" className="mt-5 inline-flex items-center font-bold text-primary hover:underline">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            ダッシュボードへ戻る
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAEB] text-foreground">
      <header className="sticky top-0 z-50 border-b border-primary/10 bg-white/95 px-3 py-3 shadow-sm backdrop-blur-md md:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="ダッシュボードへ戻る">
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black text-slate-900 md:text-2xl">学習の振り返り</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">これまでの取り組みから、次の一歩を見つけよう</p>
            </div>
          </div>
          <ThemeSettingsButton labelClassName="hidden sm:inline" />
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-7 px-4 py-6 md:px-6 md:py-8">
        {error && (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
            {error}
          </div>
        )}

        <section aria-labelledby="summary-heading">
          <div className="mb-4 flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="summary-heading" className="text-xl font-black text-slate-900">今までの取り組み</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard icon={BookOpenCheck} label="演習回数" value={`${report.overall.allTimeAttempts}回`} note="全期間" />
            <SummaryCard icon={Clock3} label="取り組み時間" value={formatDuration(report.overall.studyTimeSec)} note="計測開始後" />
            <SummaryCard icon={Target} label="正答率" value={report.overall.accuracy === null ? '—' : `${report.overall.accuracy}%`} note={`${report.overall.answeredCount}問を集計`} />
            <SummaryCard icon={CheckCircle2} label="定着した単元" value={`${report.overall.masteredUnits} / ${report.overall.totalUnits}`} note={`取り組み済み ${report.overall.touchedUnits}単元`} />
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            演習回数はこれまでの全記録です。時間と正答率は、この振り返り機能の計測開始後の演習から集計します。
          </p>
        </section>

        <section aria-labelledby="recommendations-heading">
          <div className="mb-4 flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-violet-600" aria-hidden="true" />
            <h2 id="recommendations-heading" className="text-xl font-black text-slate-900">次におすすめの学習</h2>
          </div>
          {report.recommendations.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-3">
              {report.recommendations.map((unit, index) => (
                <Card key={unit.id} className="border-violet-100 bg-white shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wider text-violet-500">おすすめ {index + 1}</p>
                        <CardTitle className="mt-1 text-lg">{unit.title}</CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">{unit.category}</p>
                      </div>
                      <StatusBadge status={unit.status} label={unit.statusLabel} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="min-h-12 text-sm leading-6 text-slate-600">{unit.recommendationReason}</p>
                    <Link
                      href={`/drill/${encodeURIComponent(unit.id)}${unit.recommendedMode === 'wrong' ? '?mode=wrong' : ''}`}
                      className="inline-flex w-full items-center justify-center rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                    >
                      {unit.recommendedMode === 'wrong' ? <RotateCcw className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
                      {unit.recommendedMode === 'wrong' ? '間違いを復習する' : 'この単元に取り組む'}
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="border-emerald-200 bg-emerald-50/80">
              <CardContent className="flex items-center gap-3 p-5 text-emerald-900">
                <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden="true" />
                <p className="font-bold">現在の記録では、優先して復習する単元はありません。新しい単元へ進みましょう。</p>
              </CardContent>
            </Card>
          )}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.1fr_1fr]" aria-label="最近の学習と分野別状況">
          <Card className="bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarDays className="h-5 w-5 text-primary" aria-hidden="true" />
                直近28日の取り組み
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex gap-6 text-sm">
                <div><span className="font-black text-slate-900">{activeDays}日</span><span className="ml-1 text-muted-foreground">学習</span></div>
                <div><span className="font-black text-slate-900">{formatDuration(recentStudyTime)}</span><span className="ml-1 text-muted-foreground">取り組み</span></div>
              </div>
              <div className="flex h-36 items-end gap-1 rounded-xl bg-slate-50 px-2 pb-2 pt-4" role="img" aria-label={`直近28日では${activeDays}日学習し、合計${formatDuration(recentStudyTime)}取り組みました`}>
                {report.daily.map((day) => {
                  const height = day.studyTimeSec > 0
                    ? Math.max(8, Math.round((day.studyTimeSec / maxDailyStudyTime) * 100))
                    : 3;
                  return (
                    <div key={day.date} className="flex h-full min-w-0 flex-1 items-end" title={`${day.date}: ${formatDuration(day.studyTimeSec)}・${day.attempts}回`}>
                      <div className={`w-full rounded-t-sm ${day.studyTimeSec > 0 ? 'bg-primary' : 'bg-slate-200'}`} style={{ height: `${height}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-slate-400"><span>28日前</span><span>今日</span></div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
                分野別の状況
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-72 space-y-4 overflow-y-auto pr-2">
              {report.categories.map((category) => (
                <div key={category.category}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-bold text-slate-800">{category.category}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {category.accuracy === null ? '未計測' : `正答率 ${category.accuracy}%`}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${category.accuracy ?? 0}%` }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
                    <span>{category.allTimeAttempts}回・{formatDuration(category.studyTimeSec)}</span>
                    <span>定着 {category.masteredUnits}/{category.totalUnits}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <LearningAdvice report={report} />

        <section aria-labelledby="units-heading">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 id="units-heading" className="text-xl font-black text-slate-900">単元別の記録</h2>
              <p className="mt-1 text-sm text-muted-foreground">表示中 {filteredUnits.length}単元</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-xs font-bold text-slate-600">
                分野
                <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 sm:w-48">
                  <option value="all">すべて</option>
                  {report.categories.map((category) => <option key={category.category} value={category.category}>{category.category}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600">
                状態
                <select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as StatusFilter)} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 sm:w-36">
                  {STATUS_FILTERS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600">
                並び順
                <select value={sortOption} onChange={(event) => setSortOption(event.target.value as SortOption)} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 sm:w-40">
                  <option value="recommendation">おすすめ順</option>
                  <option value="accuracy">正答率順</option>
                  <option value="recent">最近取り組んだ順</option>
                  <option value="attempts">演習回数順</option>
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {filteredUnits.map((unit) => (
              <Card key={unit.id} className="bg-white shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black uppercase tracking-wider text-primary/70">{unit.category}</p>
                      <h3 className="mt-1 text-base font-black text-slate-900">{unit.title}</h3>
                    </div>
                    <StatusBadge status={unit.status} label={unit.statusLabel} />
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                    <Metric label="回数" value={`${unit.allTimeAttempts}回`} />
                    <Metric label="時間" value={formatDuration(unit.studyTimeSec)} />
                    <Metric label="正答率" value={unit.accuracy === null ? '—' : `${unit.accuracy}%`} />
                    <Metric label="最終" value={formatDate(unit.lastAttemptAt)} />
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-600">{unit.recommendationReason}</p>
                  <Link
                    href={`/drill/${encodeURIComponent(unit.id)}${unit.recommendedMode === 'wrong' ? '?mode=wrong' : ''}`}
                    className="mt-4 inline-flex items-center text-sm font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {unit.recommendedMode === 'wrong' ? '間違いを復習する' : 'この単元に取り組む'}
                    <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredUnits.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-sm text-slate-500">
              条件に合う単元はありません。
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof BookOpenCheck;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Card className="bg-white shadow-sm">
      <CardContent className="flex items-start gap-3 p-5">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-bold text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
          <p className="mt-1 text-[11px] text-slate-400">{note}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, label }: { status: LearningStatus; label: string }) {
  return <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black ${STATUS_STYLES[status]}`}>{label}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1 py-2">
      <p className="text-[10px] font-bold text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-xs font-black text-slate-800" title={value}>{value}</p>
    </div>
  );
}
