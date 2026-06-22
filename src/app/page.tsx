'use client';

import { useAuth } from '@/contexts/AuthContext';
import { calculateLevelAndProgress, getTitleForLevel, getAvailableIcons } from '@/lib/xp';
import { hasAcceptedCurrentLegalDocs, LEGAL_EFFECTIVE_DATE_LABEL } from '@/lib/legal';
import { Button } from '@/components/ui/button';
import { LogOut, PlayCircle, Trophy, Clock, Medal, Database, RefreshCw, MessageSquare, Send, XCircle, Megaphone } from 'lucide-react';
import Image from 'next/image';
import { db, functions } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { setDoc } from 'firebase/firestore';

interface Unit {
  id: string;
  title: string;
  questions?: any[]; 
  totalQuestions?: number;
  category?: string;
  subject?: string;
  baseSubject?: string;
  mode?: string;
  drillType?: 'multiple_choice' | 'written';
  writtenAttemptLimit?: number;
  eventStatus?: string;
}

interface Score {
  unitId: string;
  maxScore: number;
  bestTime: number;
}

interface OverallRank {
  uid: string;
  name: string;
  totalScore: number;
  xp: number;
  icon?: string;
  level?: number;
}

interface WrittenStat {
  maxScore?: number;
  attemptCount?: number;
  remainingAttempts?: number;
  limit?: number;
}

const UNITS_CACHE_KEY = 'math_units_cache_v4';
const UNITS_CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000;
const DRILL_DATA_CACHE_PREFIX = 'math_drill_data_cache_v1:';

function clearDrillDataCache() {
  if (typeof window === 'undefined') return;
  Object.keys(localStorage)
    .filter(key => key.startsWith(DRILL_DATA_CACHE_PREFIX))
    .forEach(key => localStorage.removeItem(key));
}

function isBattleUnit(unit: Unit) {
  const subject = String(unit.subject || '');
  // mojibake-ok: legacy imported battle subject values are kept for compatibility.
  return unit.mode === 'battle' || subject.endsWith('対戦') || subject.endsWith('蟇ｾ謌ｦ');
}

function isMathSubjectValue(value?: string) {
  // mojibake-ok: legacy imported math subject values are kept for compatibility.
  return !value || value === 'math' || value === '数学' || value === '謨ｰ蟄ｦ';
}

function parseEventDate(value: any): number | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
  }
  if (value?.toDate) return value.toDate().getTime();
  return null;
}

function isVisibleUnit(unit: Unit) {
  if (unit.drillType !== 'written') return true;
  if ((unit.eventStatus || 'active') !== 'active') return false;

  const now = Date.now();
  const startsAt = parseEventDate((unit as any).eventStartsAt);
  const endsAt = parseEventDate((unit as any).eventEndsAt);
  if (startsAt && startsAt > now) return false;
  if (endsAt && endsAt < now) return false;
  return true;
}

export default function Home() {
  const { user, logout, agreeToTerms } = useAuth();
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string>('数学');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [overallRanking, setOverallRanking] = useState<OverallRank[]>([]);
  const [showMoreRanking, setShowMoreRanking] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [myRankInfo, setMyRankInfo] = useState<{ rank: number; data: OverallRank } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wrongAnswers, setWrongAnswers] = useState<Record<string, number>>({});
  const [drillCounts, setDrillCounts] = useState<Record<string, number>>({});
  const [writtenStats, setWrittenStats] = useState<Record<string, WrittenStat>>({});
  const [showXpInfo, setShowXpInfo] = useState(false);
  const [userData, setUserData] = useState<{ xp: number; icon: string; title: string; level: number; progress: number } | null>(null);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [savingTerms, setSavingTerms] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [unitsRefreshToken, setUnitsRefreshToken] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (user && !hasAcceptedCurrentLegalDocs(user) && process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR !== 'true') {
      setShowTermsModal(true);
    } else {
      setShowTermsModal(false);
    }
  }, [user]);

  useEffect(() => {
    async function fetchData() {
      if (!user) return;
      setLoading(true);
      setError(null);
      try {
        // 1. Fetch units with caching
        localStorage.removeItem('math_units_cache'); // v1 cleanup
        const cachedUnits = unitsRefreshToken > 0 ? null : localStorage.getItem(UNITS_CACHE_KEY);
        let unitsData: Unit[] = [];
        
        if (cachedUnits) {
          try {
            const parsed = JSON.parse(cachedUnits);
            if (Date.now() - parsed.timestamp < UNITS_CACHE_EXPIRY_MS) {
              unitsData = parsed.data;
            }
          } catch (e) {
            console.error('Failed to parse units cache', e);
          }
        }
        
        if (unitsData.length === 0) {
          const unitsSnap = await getDocs(collection(db, 'units'));
          unitsData = unitsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Unit));
          localStorage.setItem(UNITS_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: unitsData }));
        }

        const soloUnitsData = unitsData.filter(unit => !isBattleUnit(unit) && isVisibleUnit(unit));

        // 2 & 3. Fetch user's stats and extract scores / wrong answers
        const newScores: Record<string, Score> = {};
        const newWrongAnswers: Record<string, number> = {};
        const newDrillCounts: Record<string, number> = {};
        const newWrittenStats: Record<string, WrittenStat> = {};

        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const ud = userSnap.data();
          
          if (ud.unitStats) {
            // Helper to get nested value from object using dot-notated key
            const getNestedValue = (obj: any, path: string) => {
              if (obj[path]) return obj[path];
              const parts = path.split('.');
              let current = obj;
              for (const part of parts) {
                if (current && typeof current === 'object' && part in current) {
                  current = current[part];
                } else {
                  return undefined;
                }
              }
              return current;
            };

            soloUnitsData.forEach(unit => {
              const stat = getNestedValue(ud.unitStats, unit.id);
              if (stat && stat.maxScore !== undefined) {
                newScores[unit.id] = {
                  unitId: unit.id,
                  maxScore: stat.maxScore,
                  bestTime: stat.bestTime || Infinity,
                };
                if (stat.wrongQuestionIds && stat.wrongQuestionIds.length > 0) {
                  newWrongAnswers[unit.id] = stat.wrongQuestionIds.length;
                }
                if (stat.drillCount !== undefined) {
                  newDrillCounts[unit.id] = stat.drillCount;
                }
              }
            });
          }
          if (ud.writtenStats) {
            soloUnitsData.forEach(unit => {
              const stat = ud.writtenStats[unit.id];
              if (stat) {
                newWrittenStats[unit.id] = stat;
              }
            });
          }

          setUserData({
            xp: ud.xp || 0,
            icon: ud.icon || '📐',
            title: ud.title || '算数卒業生',
            level: ud.level || 1,
            progress: ud.progressPercent !== undefined ? ud.progressPercent : calculateLevelAndProgress(ud.xp || 0).progressPercent
          });
        }

        setWrongAnswers(newWrongAnswers);
        setDrillCounts(newDrillCounts);
        setWrittenStats(newWrittenStats);
        // Sort units: Category ASC, then Title ASC
        soloUnitsData.sort((a, b) => {
          const catA = a.category || 'その他';
          const catB = b.category || 'その他';
          if (catA !== catB) return catA.localeCompare(catB, 'ja', { numeric: true });
          return a.title.localeCompare(b.title, 'ja', { numeric: true });
        });

        setUnits(soloUnitsData);

        // Extract available categories
        const categories = Array.from(new Set(soloUnitsData.map(u => u.category || 'その他'))).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
        setAvailableCategories(categories);
        setSelectedCategory(categories.at(-1) || 'all');

        setScores(newScores);
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
        setError("データの読み込み中にエラーが発生しました。通信環境を確認して、ページを再読み込みしてください。");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [user, unitsRefreshToken]);

  const startDrill = (unitId: string) => {
    router.push(`/drill/${unitId}`);
  };

  const handleSubmitFeedback = async () => {
    const message = feedbackText.trim();
    if (!message || feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    setFeedbackStatus('');
    try {
      const submitFeedback = httpsCallable(functions, 'submitFeedback');
      await submitFeedback({
        message,
        pagePath: typeof window !== 'undefined' ? window.location.pathname : '/',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      });
      setFeedbackText('');
      setFeedbackStatus('送信しました。ありがとうございます。');
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      setFeedbackStatus('送信に失敗しました。時間をおいてもう一度お試しください。');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  // ランキング読み込み（ボタン押下時のみ）
  const loadRanking = async () => {
    if (!user) return;
    setRankingLoading(true);
    try {
      const leaderboardSnap = await getDoc(doc(db, 'leaderboards', 'overall'));
      if (leaderboardSnap.exists()) {
        const data = leaderboardSnap.data();
        const rankings: OverallRank[] = (data.rankings || []).map((r: any) => ({
          uid: r.uid,
          name: r.name,
          totalScore: r.totalScore,
          xp: r.xp || 0,
          icon: r.icon || '📐',
          level: r.level || 1,
        }));
        setOverallRanking(rankings);
        setTotalParticipants(data.totalParticipants || 0);

        // 自分の順位を特定
        const myIndex = rankings.findIndex(r => r.uid === user.uid);
        if (myIndex !== -1) {
          setMyRankInfo({ rank: myIndex + 1, data: rankings[myIndex] });
        } else {
          // 圏外（41位以下）の場合
          const calculatedTotalScore = Object.values(scores).reduce((acc, s) => acc + (s.maxScore || 0), 0);
          setMyRankInfo({
            rank: 41, // 41位以下のフラグとして使用
            data: {
              uid: user.uid,
              name: user.displayName || 'あなた',
              totalScore: calculatedTotalScore,
              xp: userData?.xp || 0,
              icon: userData?.icon || '📐',
              level: userData?.level || 1
            }
          });
        }
      }
      setShowRanking(true);
    } catch (err) {
      console.error('Error loading leaderboard:', err);
    } finally {
      setRankingLoading(false);
    }
  };

  const handleIconChange = async (icon: string) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), { icon }, { merge: true });
      setUserData(prev => prev ? { ...prev, icon } : null);
      setIsAvatarModalOpen(false);
    } catch (e) {
      console.error(e);
      alert('アバターの保存に失敗しました');
    }
  };

  const handleAgreeToTerms = async () => {
    if (!termsChecked) return;
    setSavingTerms(true);
    await agreeToTerms();
    setSavingTerms(false);
    setShowTermsModal(false);
  };

  return (
    <div className="min-h-screen bg-[#F8FAEB] flex flex-col">
      <header className="bg-white/95 backdrop-blur-md border-b border-primary/10 px-6 py-4 flex items-center justify-between sticky top-0 z-50 transition-all shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 md:w-12 md:h-12 overflow-hidden rounded-[1rem] shadow-md flex items-center justify-center flex-shrink-0">
            <Image src="/images/icon.webp" alt="Formix Icon" width={64} height={64} className="object-cover w-full h-full" />
          </div>
          <div className="flex flex-col justify-center">
            <h1 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight leading-none mb-[2px]">Formix</h1>
            <p className="text-[10px] text-muted-foreground/80 uppercase tracking-widest font-semibold leading-none">Forming the Essence of Knowledge.</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsFeedbackModalOpen(true)}
            className="inline-flex border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 font-bold"
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            <span className="hidden md:inline">意見を送る</span>
            <span className="md:hidden">意見</span>
          </Button>
          <span className="text-sm font-medium text-gray-700 hidden sm:inline-block bg-gray-100 px-3 py-1.5 rounded-full">
            {user?.displayName} <span className="text-xs text-muted-foreground font-normal ml-1">さん</span>
          </span>
          <Button variant="ghost" size="sm" onClick={logout} className="text-muted-foreground hover:text-primary">
            <LogOut className="w-4 h-4 mr-2" />
            ログアウト
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin h-10 w-10 border-4 border-primary/20 border-t-primary rounded-full"></div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-20">
            <Card className="max-w-md w-full border-0 shadow-xl">
              <CardHeader className="text-center">
                <div className="flex justify-center mb-4">
                  <div className="bg-red-50 p-4 rounded-full">
                    <Database className="w-10 h-10 text-red-500" />
                  </div>
                </div>
                <CardTitle className="text-xl font-bold">データの読み込みに失敗しました</CardTitle>
                <CardDescription className="text-sm mt-2">
                  {error}
                </CardDescription>
              </CardHeader>
              <CardFooter className="flex justify-center pb-8 p-6">
                <Button 
                  onClick={() => window.location.reload()}
                  className="bg-primary hover:bg-primary/90 font-bold px-8 shadow-md"
                >
                  <RefreshCw className="w-4 h-4 mr-2" /> 再読み込み
                </Button>
              </CardFooter>
            </Card>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* User XP Profile Banner */}
            {userData && (
              <div className="lg:col-span-3 bg-white rounded-2xl p-6 shadow-sm border border-primary/10 flex flex-col md:flex-row items-center gap-6 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-20 -mt-20"></div>

                {/* Avatar */}
                <div
                  className="relative cursor-pointer transition-transform hover:scale-105"
                  onClick={() => setIsAvatarModalOpen(true)}
                >
                  <div className="w-24 h-24 bg-gradient-to-br from-[#F8FAEB] to-green-100 rounded-full border-4 border-white shadow-lg flex items-center justify-center text-5xl flex-shrink-0 z-10 relative">
                    {userData.icon}
                    <div className="absolute -bottom-2 -right-2 bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full border-2 border-white shadow-sm tracking-widest uppercase">
                      Lv.{userData.level}
                    </div>
                  </div>
                  <div className="absolute inset-0 bg-black/60 rounded-full opacity-0 hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-xs font-bold z-20">
                    <span className="mb-0.5 tracking-wider">変更</span>
                    <span className="text-[10px] font-normal opacity-80">クリック</span>
                  </div>
                </div>

                {/* Info & Progress */}
                <div className="flex-1 w-full relative z-10">
                  <div className="flex justify-between items-end mb-2">
                    <div>
                      <p className="text-sm font-bold text-primary/80 tracking-widest">{userData.title}</p>
                      <h2 className="text-2xl font-black text-gray-800 tracking-tight">{user?.displayName} <span className="text-sm font-bold text-muted-foreground ml-1">さん</span></h2>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest leading-none">Total XP</p>
                      <p className="text-2xl font-black text-primary font-mono">{userData.xp}</p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-gray-100 h-3.5 rounded-full overflow-hidden shadow-inner">
                    <div
                      className="bg-gradient-to-r from-[#88c946] to-primary h-full rounded-full transition-all duration-1000 ease-out relative"
                      style={{ width: `${userData.progress}%` }}
                    >
                      <div className="absolute top-0 right-0 bottom-0 left-0 bg-white/20 animate-pulse"></div>
                    </div>
                  </div>
                  <div className="flex justify-between mt-1.5 text-[11px] font-mono text-muted-foreground font-semibold">
                    <span>Lv.{userData.level}</span>
                    <span>Lv.{userData.level + 1}</span>
                  </div>
                </div>
              </div>
            )}

            {/* XP Rules Info */}
            <div className="lg:col-span-3">
              <button
                onClick={() => setShowXpInfo(v => !v)}
                className="flex items-center gap-2 text-xs text-muted-foreground/60 hover:text-primary transition-colors font-semibold tracking-wider uppercase mb-2"
              >
                <Database className="w-3.5 h-3.5" />
                経験値(XP)の獲得ルール {showXpInfo ? '▲' : '▼'}
              </button>
              {showXpInfo && (
                <div className="bg-white/80 rounded-xl border border-gray-100 shadow-sm p-4 text-xs text-gray-600 space-y-1.5 leading-relaxed">
                  <p>・ 正解数に応じてベースXPが加算されます。</p>
                  <p>・ <span className="font-semibold text-primary">連続正解</span>が続くほどコンボボーナスが積み上がります。</p>
                  <p>・ <span className="font-semibold text-primary">正答率</span>が高いほど倍率ボーナスがかかります。</p>
                  <p>・ 同じ単元への取り組み回数が増えるほど、獲得XPが段階的に減少します。</p>
                  <p>・ 11回目以降は全問正解ボーナスが加わるようになります。</p>
                </div>
              )}
            </div>

            {/* Update Log */}
            <div className="lg:col-span-3 bg-white/80 rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2">
                  <Megaphone className="w-3.5 h-3.5 text-primary/60" />
                  <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground/60">最新のアップデート</span>
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground/50">最終更新: 2026年6月17日</span>
              </div>
              <ul className="text-xs text-gray-600 space-y-1 leading-relaxed">
                <li>・ <span className="font-semibold text-primary">試験対策演習</span>を追加しました。表示されない場合は、下の「更新」を押してください。</li>
                <li>・ 試験に向けて、苦手な単元を後回しにせず、毎日少しずつしっかり取り組みましょう。</li>
                <li>・ アプリの演習だけで終わらせず、<span className="font-semibold text-primary">完成ノート</span>も併用して解き方を整理しましょう。</li>
                <li>・ 4択問題では練習しきれない<span className="font-semibold text-primary">記述式問題</span>の対策も、途中式や説明を書く練習として必ず行いましょう。</li>
              </ul>
            </div>

            {/* Units List (Left/Top) */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center gap-3">
                  <PlayCircle className="w-8 h-8 text-primary flex-shrink-0" />
                  <div>
                    <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">教科・分野一覧</h2>
                    <p className="text-[11px] md:text-xs text-muted-foreground font-medium uppercase tracking-wider">Select a unit to start</p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      localStorage.removeItem(UNITS_CACHE_KEY);
                      clearDrillDataCache();
                      setUnitsRefreshToken(prev => prev + 1);
                    }}
                    disabled={loading}
                    className="h-10 font-bold"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    更新
                  </Button>
                  {/* Subject Selector */}
                  <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-xl border border-gray-100 shadow-inner group transition-all hover:border-primary/30">
                    <span className="text-[11px] font-bold text-primary/70 pl-3 uppercase tracking-tighter">教科</span>
                    <select
                      value={selectedSubject}
                      onChange={(e) => setSelectedSubject(e.target.value)}
                      className="flex-1 w-full sm:w-28 text-sm border-none bg-white rounded-lg px-2 py-2 font-bold text-gray-800 outline-none cursor-pointer focus:ring-2 ring-primary/20 transition-all"
                    >
                      <option value="数学">数学</option>
                      <option value="英語" disabled>英語 (準備中)</option>
                    </select>
                  </div>

                  {/* Category Selector */}
                  <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-xl border border-gray-100 shadow-inner group transition-all hover:border-primary/30">
                    <span className="text-[11px] font-bold text-primary/70 pl-3 uppercase tracking-tighter">分野</span>
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="flex-1 w-full sm:w-40 text-sm border-none bg-white rounded-lg px-2 py-2 font-bold text-gray-800 outline-none cursor-pointer focus:ring-2 ring-primary/20 transition-all"
                    >
                      <option value="all">すべて表示</option>
                      {availableCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {units.length === 0 ? (
                <Card className="border-dashed border-2 shadow-none bg-white/50">
                  <CardContent className="flex flex-col items-center justify-center p-16 text-muted-foreground">
                    <p className="text-lg">利用可能な単元がありません。</p>
                    {(user?.email === 'kazuki2kr@gmail.com' || user?.email === 'ichikawa.kazuki@shibaurafzk.com') && (
                      <Button variant="link" onClick={() => router.push('/admin')} className="mt-4 text-primary">
                        管理画面でCSVアップロード
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2">
                  {units
                    .filter(unit => isMathSubjectValue(selectedSubject) ? isMathSubjectValue(unit.subject) : unit.subject === selectedSubject)
                    .filter(unit => selectedCategory === 'all' || (unit.category || 'その他') === selectedCategory)
                    .map((unit) => {
                      const myScore = scores[unit.id];
                      const totalQ = unit.totalQuestions !== undefined ? unit.totalQuestions : (unit.questions?.length || 0);
                      const isWrittenUnit = unit.drillType === 'written';
                      const writtenStat = writtenStats[unit.id];
                      const writtenLimit = Math.max(2, Number(unit.writtenAttemptLimit) || 2);
                      const writtenAttemptCount = writtenStat?.attemptCount || 0;
                      const writtenRemaining = Math.max(
                        writtenStat?.remainingAttempts ?? 0,
                        Math.max(0, writtenLimit - writtenAttemptCount)
                      );
                      const hasPlayed = isWrittenUnit ? !!writtenStat : !!myScore;
                      const displayTitle = unit.title.replace(/^単元\s*/, '');
                      const drillCount = drillCounts[unit.id];

                      return (
                        <Card
                          key={unit.id}
                          className="flex flex-col overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 group bg-white border-transparent hover:border-primary/20"
                        >
                          <CardHeader className="pb-4 border-b bg-gray-50/50 group-hover:bg-primary/5 transition-colors">
                            <div className="space-y-1">
                              <div className="text-[10px] font-black text-primary/60 uppercase tracking-widest transition-colors group-hover:text-primary/80">
                                {unit.category || 'その他'}
                              </div>
                              <CardTitle className="text-lg font-bold text-gray-900 group-hover:text-primary transition-colors leading-tight">
                                {displayTitle}
                              </CardTitle>
                            </div>
                          </CardHeader>
                          <CardContent className="flex-1 pt-4 pb-5">
                            {hasPlayed ? (
                              <div className="space-y-1 mt-1 bg-green-50/70 p-4 rounded-xl border border-green-100/50 shadow-inner">
                                <div className="text-xs font-semibold text-green-800/70 flex items-center mb-2 uppercase tracking-wide">
                                  <Trophy className="w-3.5 h-3.5 mr-1" />
                                  {isWrittenUnit ? 'Best Written Score' : 'Highest Score'}
                                </div>
                                <div className="text-4xl font-extrabold text-primary flex items-baseline gap-1">
                                  {isWrittenUnit ? writtenStat?.maxScore || 0 : myScore.maxScore} <span className="text-sm font-medium text-primary/60">/ 100</span>
                                </div>
                                {isWrittenUnit ? (
                                  <div className="text-xs text-primary/70 mt-2 font-mono">
                                    残り提出回数: {writtenRemaining}/{writtenLimit}
                                  </div>
                                ) : (
                                  <div className="flex items-center text-xs text-primary/70 mt-2 font-mono">
                                    <Clock className="w-3 h-3 mr-1" />
                                    Time: {myScore.bestTime}s
                                  </div>
                                )}
                                {drillCount !== undefined && (
                                  <div className="mt-2 pt-2 border-t border-green-100">
                                    <span className="text-xs text-gray-400 font-mono">演習回数: {drillCount}回</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="space-y-2 mt-1 bg-gray-50/80 p-4 rounded-xl border border-gray-100 flex items-center justify-center min-h-[110px]">
                                <span className="text-muted-foreground/60 text-sm font-bold tracking-widest uppercase">未受験</span>
                              </div>
                            )}
                          </CardContent>
                          <CardFooter className="flex flex-col gap-2 px-6 pb-6 pt-0">
                            <Button
                              className="w-full shadow-md hover:shadow-lg transition-shadow bg-primary text-primary-foreground font-semibold"
                              onClick={() => startDrill(unit.id)}
                              disabled={totalQ === 0 || (isWrittenUnit && writtenRemaining <= 0)}
                            >
                              <PlayCircle className="w-4 h-4 mr-2" />
                              演習開始
                            </Button>
                            {!isWrittenUnit && <Button
                              variant="outline"
                              className="w-full shadow-sm hover:shadow-md transition-shadow border-primary/20 bg-white text-primary text-xs font-bold"
                              onClick={() => router.push(`/drill/${unit.id}?mode=all`)}
                              disabled={totalQ === 0}
                            >
                              <PlayCircle className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                              全問に取り組む ({totalQ}問)
                            </Button>}
                            {isWrittenUnit && (
                              <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                                1問イベントです。スコアは総合ランキングには含まれず、XPのみ得点に応じて反映されます。
                              </p>
                            )}
                            {!isWrittenUnit && wrongAnswers[unit.id] > 0 && (
                              <Button
                                variant="secondary"
                                className="w-full shadow-sm hover:shadow-md transition-shadow bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-200 text-xs font-bold"
                                onClick={() => router.push(`/drill/${unit.id}?mode=wrong`)}
                              >
                                <PlayCircle className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                                間違えた問題のみ復習 ({wrongAnswers[unit.id]}問)
                              </Button>
                            )}
                          </CardFooter>
                        </Card>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Overall Ranking (Right/Bottom) */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-extrabold text-amber-500 flex items-center gap-2">
                    <Medal className="w-6 h-6" /> 総合ランキング
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1 ml-8">全単元の合計スコア</p>
                </div>
              </div>

              {!showRanking ? (
                <Card className="shadow-sm border-t-4 border-t-amber-400 overflow-hidden bg-white/95">
                  <CardContent className="p-8 flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center">
                      <Trophy className="w-8 h-8 text-amber-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground/60">同点の場合は経験値(XP)が多い方が上位です</p>
                    </div>
                    <Button
                      onClick={loadRanking}
                      disabled={rankingLoading}
                      className="bg-amber-500 hover:bg-amber-600 text-white font-bold shadow-md hover:shadow-lg transition-all"
                    >
                      {rankingLoading ? (
                        <><div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2" /> 読み込み中...</>
                      ) : (
                        <><Medal className="w-4 h-4 mr-2" /> 総合ランキングを表示</>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card className="shadow-lg border-t-4 border-t-amber-400 overflow-hidden bg-white/95">
                  <CardContent className="p-0 flex flex-col">
                    {/* Highlight My Rank if available */}
                    {myRankInfo && (
                      <div className="bg-amber-100/60 border-b border-amber-200 p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-amber-500 text-white rounded-full flex items-center justify-center font-black text-sm shadow-sm">
                            {myRankInfo.rank > 40 ? '圏外' : myRankInfo.rank}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-amber-800 tracking-wider">
                              {myRankInfo.rank > 40 ? '41位以下' : 'あなたの現在の順位'}
                            </p>
                            <p className="text-xl font-black text-amber-900 leading-none mt-1 flex items-baseline gap-0.5">
                              {myRankInfo.data.totalScore}
                              <span className="text-xs font-bold opacity-70">点</span>
                            </p>
                          </div>
                        </div>
                        <p className="text-[10px] text-amber-700/60 font-mono">{totalParticipants}名中</p>
                      </div>
                    )}

                    {overallRanking.length === 0 ? (
                      <div className="text-center p-8 text-muted-foreground text-sm">
                        まだ誰のスコアもありません。
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {overallRanking.slice(0, showMoreRanking ? 40 : 10).map((rankUser, index) => {
                          const rank = index + 1;
                          const isCurrentUser = rankUser.uid === user?.uid;

                          return (
                            <div
                              key={rankUser.uid}
                              className={`flex items-center px-5 py-4 transition-colors ${isCurrentUser ? 'bg-amber-50/50 relative' : 'hover:bg-gray-50'
                                }`}
                            >
                              {isCurrentUser && <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"></div>}
                              <div className="w-8 flex-shrink-0 text-center font-black mr-3">
                                {rank === 1 ? <Medal className="text-yellow-500 w-6 h-6 mx-auto" /> :
                                  rank === 2 ? <Medal className="text-gray-400 w-5 h-5 mx-auto" /> :
                                    rank === 3 ? <Medal className="text-amber-700 w-5 h-5 mx-auto" /> :
                                      <span className="text-gray-400">{rank}</span>}
                              </div>
                              <div className="flex-1 min-w-0 flex items-center gap-3">
                                <div className="text-3xl filter drop-shadow hover:scale-110 transition-transform hidden sm:block">{rankUser.icon}</div>
                                <div>
                                  <p className="font-bold text-gray-800 truncate text-sm flex items-center">
                                    <span className="text-xl sm:hidden mr-1">{rankUser.icon}</span>
                                    {rankUser.name}
                                    {isCurrentUser && <span className="ml-2 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full uppercase">You</span>}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground font-mono font-semibold">Lv.{rankUser.level || 1}</p>
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0 ml-4">
                                <p className="text-lg font-black text-amber-600 leading-none flex items-baseline justify-end gap-0.5">
                                  {rankUser.totalScore}
                                  <span className="text-[10px] font-bold opacity-70">点</span>
                                </p>
                                <p className="text-[10px] text-gray-400 font-mono mt-1">
                                  XP {rankUser.xp?.toLocaleString()}
                                </p>
                              </div>
                            </div>
                          );
                        })}

                        {overallRanking.length > 10 && !showMoreRanking && (
                          <Button
                            variant="ghost"
                            className="w-full text-[10px] h-9 text-muted-foreground hover:bg-amber-50 transition-colors"
                            onClick={() => setShowMoreRanking(true)}
                          >
                            もっと見る (Top 40まで)
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card className="shadow-sm border-t-4 border-t-primary overflow-hidden bg-white/95">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-primary" />
                    フィードバック
                  </CardTitle>
                  <CardDescription className="text-xs leading-relaxed">
                    Formix を少しずつみんなで良くしていくための入り口です。<br />
                    小さな気づきも歓迎しています！
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-600">
                  <Button
                    onClick={() => setIsFeedbackModalOpen(true)}
                    className="w-full shadow-sm font-bold"
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    フィードバックを書く
                  </Button>
                  {feedbackStatus && (
                    <p className="text-xs font-medium text-primary">{feedbackStatus}</p>
                  )}
                </CardContent>
              </Card>
            </div>

          </div>
        )}
      </main>

      {/* Avatar Select Modal */}
      {isAvatarModalOpen && userData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl scale-in-center flex flex-col max-h-[85vh]">
            <div className="p-6 border-b bg-gray-50 flex justify-between items-center sticky top-0 z-10">
              <div>
                <h3 className="text-xl font-bold text-gray-900">アバター設定</h3>
                <p className="text-xs text-muted-foreground mt-1">現在のレベル (Lv.{userData.level}) で解放されているアバター</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setIsAvatarModalOpen(false)} className="hover:bg-gray-200">閉じる</Button>
            </div>
            <div className="p-6 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              <div className="grid grid-cols-5 sm:grid-cols-6 gap-3">
                {getAvailableIcons(userData.level).map((icon, i) => (
                  <button
                    key={i}
                    onClick={() => handleIconChange(icon)}
                    title={`Lv.${i + 1} で解放`}
                    className={`aspect-square text-3xl sm:text-4xl flex items-center justify-center rounded-xl transition-all ${userData.icon === icon
                        ? 'bg-primary/20 ring-4 ring-primary scale-110 shadow-md z-10'
                        : 'bg-gray-50 hover:bg-gray-100 hover:scale-110 border border-gray-100'
                      }`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showTermsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full flex flex-col gap-6 transform animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-black text-gray-900 tracking-tight">利用規約の確認</h3>
              <p className="text-sm text-muted-foreground">
                {LEGAL_EFFECTIVE_DATE_LABEL} 改正版の利用規約とプライバシーポリシーへの同意が必要です。
              </p>
            </div>

            <div className="bg-gray-50 p-4 border rounded-xl text-sm text-gray-700 h-40 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              <p className="font-bold mb-2 text-primary">■ 生徒の皆さんへのお願い</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Formix は数学・漢字・対戦・記述式イベントを含む学習支援サービスです。</li>
                <li>手書き答案や解答履歴は、採点、OCR、学習分析、不正検知、教員による指導のために利用されます。</li>
                <li>記述式答案は Gemini、漢字の手書き画像は Google Cloud Vision による処理を行うことがあります。</li>
                <li>ランキングでは氏名、アバター、スコア、XP、順位などが他の利用者に表示される場合があります。</li>
                <li>学習データは、個人が特定されない統計情報に加工した上で、研究発表や教育改善資料に利用されることがあります。</li>
                <li><strong>校則を遵守し</strong>、不正行為や他者の学習を妨げる行為は行わないでください。</li>
              </ul>
              <div className="mt-5 text-center flex flex-col gap-2">
                <a href="/terms" target="_blank" className="text-blue-600 hover:text-blue-800 hover:underline font-bold px-2">👉 利用規約 を読む</a>
                <a href="/privacy" target="_blank" className="text-blue-600 hover:text-blue-800 hover:underline font-bold px-2">👉 プライバシーポリシー を読む</a>
              </div>
            </div>

            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-200">
              <input
                type="checkbox"
                checked={termsChecked}
                onChange={(e) => setTermsChecked(e.target.checked)}
                className="mt-1 flex-shrink-0 w-6 h-6 text-primary rounded focus:ring-primary focus:ring-offset-2 border-gray-300"
              />
              <span className="text-sm text-gray-800 font-medium leading-relaxed">
                利用規約およびプライバシーポリシーの内容を確認し、すべての条項に同意します。
              </span>
            </label>

            <Button
              onClick={handleAgreeToTerms}
              disabled={!termsChecked || savingTerms}
              className="w-full h-12 text-lg font-bold shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5"
            >
              {savingTerms ? '処理中...' : '同意して学習を始める'}
            </Button>
          </div>
        </div>
      )}

      {isFeedbackModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl scale-in-center">
            <div className="p-6 border-b bg-gray-50 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-primary" />
                  フィードバックを送る
                </h3>
                <p className="text-xs text-muted-foreground mt-1">Formixを少しずつ良くするための入口です。</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setIsFeedbackModalOpen(false)} className="hover:bg-gray-200">
                <XCircle className="w-5 h-5" />
              </Button>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-xl border border-primary/10 bg-primary/5 p-4 text-sm leading-relaxed text-gray-700 space-y-2">
                <p>些細なことでも送ってください。アプリケーションに対する率直な感想、あったら嬉しい機能、気が付いた不具合やバグなど、小さな一言でも助かります。</p>
                <p>開発コスト、運用負荷、セキュリティなどを考えながら可能な限り実装していきます。</p>
                <p>多くの意見があるほど優先順位を決めやすくなります。どんな内容でも遠慮なく送ってください。</p>
              </div>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                maxLength={1000}
                rows={7}
                placeholder={`例:
【ほしい機能・気づいたこと】
○○のような機能が欲しいです。

【どの画面・どの単元で】
ダッシュボード / ○○の単元

【理由】
○○のときに使いやすくなると思ったからです。`}
                className="w-full resize-none rounded-xl border border-gray-200 bg-white p-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                autoFocus
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] text-muted-foreground">{feedbackText.length}/1000</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => setIsFeedbackModalOpen(false)} disabled={feedbackSubmitting}>
                    閉じる
                  </Button>
                  <Button
                    onClick={handleSubmitFeedback}
                    disabled={!feedbackText.trim() || feedbackSubmitting}
                    className="font-bold shadow-sm"
                  >
                    {feedbackSubmitting ? '送信中...' : '送信する'}
                    <Send className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
              {feedbackStatus && (
                <p className="text-xs font-medium text-primary">{feedbackStatus}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-8 mb-6 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
        <div className="flex items-center justify-center">
          <a href="/terms" className="hover:underline hover:text-primary transition-colors mx-2">利用規約</a>
          |
          <a href="/privacy" className="hover:underline hover:text-primary transition-colors mx-2">プライバシーポリシー</a>
        </div>
        <div>&copy; {new Date().getFullYear()} Shibaura Institute of Technology Junior and Senior High School K.Ichikawa</div>
      </footer>
    </div>
  );
}
