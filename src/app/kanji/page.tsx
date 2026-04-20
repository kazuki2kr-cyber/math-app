'use client';

import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { LogOut, PlayCircle, Trophy, Medal, BookOpen, PenTool } from 'lucide-react';
import Image from 'next/image';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';

interface Unit {
  id: string;
  title: string;
  questions?: any[]; 
  totalQuestions?: number;
  category?: string;
  subject?: string;
}

export default function KanjiDashboard() {
  const { user, logout } = useAuth();
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<any>(null);
  const [overallRanking, setOverallRanking] = useState<any[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function fetchData() {
      if (!user) return;
      setLoading(true);
      try {
        const uDoc = await getDoc(doc(db, 'users', user.uid));
        if (uDoc.exists()) {
          setUserData(uDoc.data());
        }

        const unitsSnap = await getDocs(collection(db, 'units'));
        const allUnits = unitsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Unit));
        // subject が kanji のものだけを抽出
        let kanjiUnits = allUnits.filter(u => u.subject === 'kanji' || u.subject === '漢字');
        
        // 検証用: データが空の場合はサンプルを表示
        if (kanjiUnits.length === 0) {
          kanjiUnits = [
            {
              id: 'sample-kanji-1',
              title: '一年生のかん字（一）',
              category: 'サンプル単元',
              totalQuestions: 3,
              subject: 'kanji'
            }
          ];
        }

        kanjiUnits.sort((a, b) => {
          const catA = a.category || 'その他';
          const catB = b.category || 'その他';
          if (catA !== catB) return catA.localeCompare(catB, 'ja', { numeric: true });
          return a.title.localeCompare(b.title, 'ja', { numeric: true });
        });

        setUnits(kanjiUnits);
      } catch (err) {
        console.error("Error fetching kanji data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [user]);

  const startDrill = (unitId: string, mode?: string) => {
    let url = `/kanji/drill/${unitId}`;
    if (mode) url += `?mode=${mode}`;
    router.push(url);
  };

  const loadRanking = async () => {
    setRankingLoading(true);
    try {
      const lbDoc = await getDoc(doc(db, 'leaderboards', 'kanji'));
      if (lbDoc.exists() && lbDoc.data().rankings) {
        setOverallRanking(lbDoc.data().rankings.slice(0, 10)); // Top 10 limited
      }
      setShowRanking(true);
    } catch (e) {
      console.error(e);
    }
    setRankingLoading(false);
  };

  const myRankInfo = React.useMemo(() => {
    if (!user || overallRanking.length === 0) return null;
    const index = overallRanking.findIndex(r => r.uid === user.uid);
    if (index === -1) return { rank: 11, data: { totalScore: userData?.kanjiTotalScore || 0 } };
    return { rank: index + 1, data: overallRanking[index] };
  }, [user, overallRanking, userData]);

  return (
    <div className="min-h-screen bg-[#FDF6E3] flex flex-col font-serif">
      <header className="bg-white/95 backdrop-blur-md border-b border-orange-900/10 px-6 py-4 flex items-center justify-between sticky top-0 z-50 transition-all shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 md:w-12 md:h-12 overflow-hidden rounded-[1rem] shadow-md flex items-center justify-center flex-shrink-0 bg-orange-50">
            <PenTool className="text-orange-900 w-6 h-6" />
          </div>
          <div className="flex flex-col justify-center">
            <h1 className="text-2xl md:text-3xl font-black text-orange-950 tracking-tight leading-none mb-[2px]">Formix 漢字</h1>
            <p className="text-[10px] text-orange-900/60 uppercase tracking-widest font-semibold leading-none">The Art of Characters.</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-orange-900 hidden sm:inline-block bg-orange-50 px-3 py-1.5 rounded-full">
            {user?.displayName} <span className="text-xs text-orange-900/60 font-normal ml-1">さん</span>
          </span>
          <Button variant="ghost" size="sm" onClick={logout} className="text-orange-900/70 hover:text-orange-900 hover:bg-orange-100">
            <LogOut className="w-4 h-4 mr-2" />
            ログアウト
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin h-10 w-10 border-4 border-orange-900/20 border-t-orange-900 rounded-full"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Units List */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-orange-900/10 shadow-sm">
                <div className="flex items-center gap-3">
                  <BookOpen className="w-8 h-8 text-orange-900 flex-shrink-0" />
                  <div>
                    <h2 className="text-xl md:text-2xl font-black text-orange-950 tracking-tight">漢字ドリル一覧</h2>
                    <p className="text-[11px] md:text-xs text-orange-900/60 font-medium tracking-wider">筆順と形を意識して書こう</p>
                  </div>
                </div>
              </div>

              {units.length === 0 ? (
                <Card className="border-dashed border-2 shadow-none bg-white/50 border-orange-900/20">
                  <CardContent className="flex flex-col items-center justify-center p-16 text-orange-900/60">
                    <p className="text-lg">利用可能な漢字単元がありません。</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2">
                  {units.map((unit) => {
                    const totalQ = unit.totalQuestions !== undefined ? unit.totalQuestions : (unit.questions?.length || 0);
                    const stats = userData?.kanjiUnitStats?.[unit.id] || null;
                    const maxScore = stats?.maxScore || 0;
                    const drillCount = stats?.drillCount || 0;
                    const wrongCount = stats?.wrongQuestionIds?.length || 0;

                    return (
                      <Card key={unit.id} className="flex flex-col overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 group bg-white border-transparent hover:border-orange-900/20">
                        <CardHeader className="pb-4 border-b bg-orange-50/50 group-hover:bg-orange-100/50 transition-colors">
                          <div className="space-y-1">
                            <div className="text-[10px] font-black text-orange-900/60 uppercase tracking-widest">{unit.category || 'その他'}</div>
                            <CardTitle className="text-lg font-bold text-orange-950 leading-tight">
                              {unit.title}
                            </CardTitle>
                          </div>
                        </CardHeader>
                        <CardContent className="flex-1 pt-4 pb-5">
                            <div className="space-y-2 mt-1 bg-orange-50/30 p-4 rounded-xl border border-orange-100 flex items-center justify-between min-h-[110px]">
                              <div className="flex flex-col items-center justify-center flex-1">
                                <span className="text-orange-900/40 text-xs font-bold tracking-widest mb-1">ハイスコア</span>
                                <span className="text-2xl font-black text-orange-950">{maxScore}<span className="text-sm font-medium opacity-60 ml-1">点</span></span>
                              </div>
                              <div className="w-px h-12 bg-orange-900/10 mx-2"></div>
                              <div className="flex flex-col items-center justify-center flex-1">
                                <span className="text-orange-900/40 text-xs font-bold tracking-widest mb-1">演習回数</span>
                                <span className="text-xl font-bold text-orange-950">{drillCount}<span className="text-sm font-medium opacity-60 ml-1">回</span></span>
                              </div>
                            </div>
                        </CardContent>
                        <CardFooter className="flex flex-col gap-2 px-6 pb-6 pt-0">
                          {wrongCount > 0 ? (
                            <div className="flex gap-2 w-full">
                              <Button
                                className="w-1/2 bg-orange-100 hover:bg-orange-200 text-orange-900 font-bold shadow-sm"
                                onClick={() => startDrill(unit.id, 'wrong')}
                              >
                                間違えた {wrongCount}問
                              </Button>
                              <Button
                                className="w-1/2 shadow-md hover:shadow-lg transition-shadow bg-orange-900 hover:bg-orange-950 text-white font-semibold"
                                onClick={() => startDrill(unit.id)}
                              >
                                通常演習
                              </Button>
                            </div>
                          ) : (
                            <Button
                              className="w-full shadow-md hover:shadow-lg transition-shadow bg-orange-900 hover:bg-orange-950 text-white font-semibold"
                              onClick={() => startDrill(unit.id)}
                              disabled={totalQ === 0}
                            >
                              <PenTool className="w-4 h-4 mr-2" />
                              手書き演習開始
                            </Button>
                          )}
                        </CardFooter>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Overall Ranking / User Card */}
            <div className="space-y-6">
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-orange-900/10 flex flex-col relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-orange-900/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
                <h3 className="text-lg font-bold text-orange-950 mb-4 flex items-center gap-2">
                  <Medal className="w-5 h-5 text-orange-600" /> あなたの段位
                </h3>
                
                {userData ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-end border-b border-orange-100 pb-2">
                      <span className="text-xs text-orange-900/60 font-bold tracking-wider">称号 / レベル</span>
                      <div className="text-right">
                        <span className="text-lg font-black text-orange-950 mr-2">{userData.kanjiTitle || '筆おろし'}</span>
                        <span className="text-xl font-bold text-orange-600">Lv.{userData.kanjiLevel || 1}</span>
                      </div>
                    </div>
                    <div className="flex justify-between items-end">
                      <span className="text-xs text-orange-900/60 font-bold tracking-wider">獲得経験値</span>
                      <span className="text-2xl font-black text-gray-900">{userData.kanjiXp || 0} <span className="text-sm font-medium text-gray-500">XP</span></span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-orange-900/70 leading-relaxed">
                    初回の演習を完了すると、ここに段位と経験値が表示されます。
                  </p>
                )}
              </div>

              {/* Ranking Section */}
              {!showRanking ? (
                <Card className="shadow-sm border-t-4 border-t-orange-400 overflow-hidden bg-white/95 border border-orange-900/10">
                  <CardContent className="p-6 flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center">
                      <Trophy className="w-8 h-8 text-orange-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-orange-900/60">同点の場合は経験値(XP)が多い方が上位です</p>
                    </div>
                    <Button
                      onClick={loadRanking}
                      disabled={rankingLoading}
                      className="bg-orange-500 hover:bg-orange-600 text-white font-bold shadow-md hover:shadow-lg transition-all w-full"
                    >
                      {rankingLoading ? (
                        <><div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2" /> 読み込み中...</>
                      ) : (
                        <><Medal className="w-4 h-4 mr-2" /> 漢字ランキングを表示 (Top 10)</>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card className="shadow-lg border-t-4 border-t-orange-400 overflow-hidden bg-white/95 border border-orange-900/10">
                  <CardContent className="p-0 flex flex-col">
                    {/* Highlight My Rank if available */}
                    {myRankInfo && (
                      <div className="bg-orange-50 border-b border-orange-100 p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-orange-500 text-white rounded-full flex items-center justify-center font-black text-sm shadow-sm">
                            {myRankInfo.rank > 10 ? '圏外' : myRankInfo.rank}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-orange-800 tracking-wider">
                              {myRankInfo.rank > 10 ? '11位以下' : 'あなたの現在の順位'}
                            </p>
                            <p className="text-xl font-black text-orange-900 leading-none mt-1 flex items-baseline gap-0.5">
                              {myRankInfo.data.totalScore}
                              <span className="text-xs font-bold opacity-70">点</span>
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {overallRanking.length === 0 ? (
                      <div className="text-center p-8 text-orange-900/60 text-sm">
                        まだ誰のスコアもありません。
                      </div>
                    ) : (
                      <div className="divide-y divide-orange-900/5">
                        {overallRanking.map((rankUser, index) => {
                          const rank = index + 1;
                          const isCurrentUser = rankUser.uid === user?.uid;

                          return (
                            <div
                              key={rankUser.uid}
                              className={`flex items-center px-5 py-4 transition-colors ${isCurrentUser ? 'bg-orange-50/50 relative' : 'hover:bg-gray-50'
                                }`}
                            >
                              {isCurrentUser && <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-400"></div>}
                              <div className="w-8 flex-shrink-0 text-center font-black mr-3">
                                {rank === 1 ? <Medal className="text-yellow-500 w-6 h-6 mx-auto" /> :
                                  rank === 2 ? <Medal className="text-gray-400 w-5 h-5 mx-auto" /> :
                                    rank === 3 ? <Medal className="text-orange-700 w-5 h-5 mx-auto" /> :
                                      <span className="text-gray-400">{rank}</span>}
                              </div>
                              <div className="flex-1 min-w-0 flex items-center gap-3">
                                <div>
                                  <p className="font-bold text-gray-800 truncate text-sm flex items-center">
                                    {rankUser.name}
                                    {isCurrentUser && <span className="ml-2 text-[10px] bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded-full uppercase">You</span>}
                                  </p>
                                  <p className="text-[10px] text-orange-900/60 font-mono font-semibold">Lv.{rankUser.level || 1} / {rankUser.xp || 0} XP</p>
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="font-black text-lg text-orange-950 leading-none">
                                  {rankUser.totalScore}
                                </p>
                                <p className="text-[9px] font-bold text-orange-900/40 uppercase tracking-widest mt-1">Score</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
