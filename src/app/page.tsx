'use client';

import { calculateLevelAndProgress, getTitleForLevel, getAvailableIcons } from '@/lib/xp';import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { LogOut, PlayCircle, Trophy, Clock, Medal } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { setDoc } from 'firebase/firestore';

interface Unit {
  id: string;
  title: string;
  questions: any[];
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
  totalTime: number;
  icon?: string;
  level?: number;
}

export default function Home() {
  const { user, logout, agreeToTerms } = useAuth();
  const [units, setUnits] = useState<Unit[]>([]);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [overallRanking, setOverallRanking] = useState<OverallRank[]>([]);
  const [myRankInfo, setMyRankInfo] = useState<{ rank: number; data: OverallRank } | null>(null);
  const [loading, setLoading] = useState(true);
  const [wrongAnswers, setWrongAnswers] = useState<Record<string, number>>({});
  const [userData, setUserData] = useState<{ xp: number; icon: string; title: string; level: number; progress: number } | null>(null);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [savingTerms, setSavingTerms] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (user && user.hasAgreedToTerms === false) {
      setShowTermsModal(true);
    } else {
      setShowTermsModal(false);
    }
  }, [user]);

  useEffect(() => {
    async function fetchData() {
      if (!user) return;
      try {
        // 1. Fetch units
        const unitsSnap = await getDocs(collection(db, 'units'));
        const unitsData = unitsSnap.docs.map(doc => doc.data() as Unit);
        
        // 2. Fetch user's best scores for dashboard display & User Profile for XP/Level
        const newScores: Record<string, Score> = {};
        for (const unit of unitsData) {
          const scoreId = `${user.uid}_${unit.id}`;
          const scoreSnap = await getDoc(doc(db, 'scores', scoreId));
          if (scoreSnap.exists()) {
            newScores[unit.id] = scoreSnap.data() as Score;
          }
        }

        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const ud = userSnap.data();
          const currentXp = ud.xp || 0;
          const { level, progressPercent } = calculateLevelAndProgress(currentXp);
          setUserData({
            xp: currentXp,
            icon: ud.icon || '📐',
            title: getTitleForLevel(level),
            level: level,
            progress: progressPercent
          });
        }

        // 3. Fetch wrong answers
        const wrongSnap = await getDocs(collection(db, 'users', user.uid, 'wrong_answers'));
        const newWrongAnswers: Record<string, number> = {};
        wrongSnap.docs.forEach(docSnap => {
          const data = docSnap.data();
          if (data.wrongQuestionIds && data.wrongQuestionIds.length > 0) {
             newWrongAnswers[docSnap.id] = data.wrongQuestionIds.length;
          }
        });
        setWrongAnswers(newWrongAnswers);

        // 4. Fetch all scores globally to calculate overall ranking
        const allScoresSnap = await getDocs(collection(db, 'scores'));
        const userTotals: Record<string, OverallRank> = {};
        
        allScoresSnap.docs.forEach(docSnap => {
          const data = docSnap.data();
          if (!userTotals[data.uid]) {
            userTotals[data.uid] = { 
               uid: data.uid, 
               name: data.userName || '名無し', 
               totalScore: 0, 
               totalTime: 0
            };
          }
          userTotals[data.uid].totalScore += (data.maxScore || 0);
          userTotals[data.uid].totalTime += (data.bestTime || 0);
        });

        const rankingList = Object.values(userTotals)
          .sort((a, b) => {
            if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
            return a.totalTime - b.totalTime;
          });

        // 必要なユーザー情報（トップ10 ＋ 自分の情報）だけをFetchする
        const uidsToFetch = new Set<string>();
        const top10Initial = rankingList.slice(0, 10);
        top10Initial.forEach(r => uidsToFetch.add(r.uid));
        
        let myIndex = -1;
        if (user) {
          myIndex = rankingList.findIndex(r => r.uid === user.uid);
          if (myIndex !== -1) {
             uidsToFetch.add(user.uid);
          }
        }

        const resolvedUsers = new Map<string, { icon: string, level: number }>();
        await Promise.all(Array.from(uidsToFetch).map(async (uid) => {
           const snap = await getDoc(doc(db, 'users', uid));
           let icon = '📐';
           let level = 1;
           if (snap.exists()) {
              const uData = snap.data();
              icon = uData.icon || '📐';
              level = calculateLevelAndProgress(uData.xp || 0).level;
           }
           resolvedUsers.set(uid, { icon, level });
        }));

        top10Initial.forEach(r => {
           const res = resolvedUsers.get(r.uid);
           if (res) {
             r.icon = res.icon;
             r.level = res.level;
           }
        });

        if (user && myIndex !== -1) {
           const myData = rankingList[myIndex];
           const res = resolvedUsers.get(user.uid);
           if (res) {
             myData.icon = res.icon;
             myData.level = res.level;
           }
           setMyRankInfo({ rank: myIndex + 1, data: myData });
        }

        setUnits(unitsData);
        setScores(newScores);
        setOverallRanking(top10Initial);
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [user]);

  const startDrill = (unitId: string) => {
    router.push(`/drill/${unitId}`);
  };

  const gotoRanking = (unitId: string) => {
    router.push(`/ranking/${unitId}`);
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
      <header className="bg-white/80 backdrop-blur-md border-b border-primary/10 px-6 py-4 flex items-center justify-between sticky top-0 z-10 transition-all shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center shadow-inner">
             {/* Small logo placeholder */}
             <span className="text-primary-foreground font-bold text-lg">SIT</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight leading-none">SIT Math Sync</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">芝浦工業大学附属中学高等学校</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
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

            {/* Units List (Left/Top) */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
                    <PlayCircle className="w-6 h-6 text-primary" /> 単元一覧
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1 ml-8">学習したい単元を選択して演習を始めましょう。</p>
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
                  {units.map((unit) => {
                    const myScore = scores[unit.id];
                    const totalQ = unit.questions?.length || 0;
                    const hasPlayed = !!myScore;
                    // "単元 " プレフィックスを削除してスッキリ表示
                    const displayTitle = unit.title.replace(/^単元\s*/, '');

                    return (
                      <Card 
                        key={unit.id} 
                        className="flex flex-col overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 group bg-white border-transparent hover:border-primary/20"
                      >
                        <CardHeader className="pb-3 border-b bg-gray-50/50 group-hover:bg-primary/5 transition-colors">
                          <CardTitle className="text-lg font-bold text-gray-900 group-hover:text-primary transition-colors">{displayTitle}</CardTitle>
                          <CardDescription className="font-mono text-xs">総問題数: {totalQ}問</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 pt-4 pb-5">
                          {hasPlayed ? (
                            <div className="space-y-1 mt-1 bg-green-50/70 p-4 rounded-xl border border-green-100/50 shadow-inner">
                              <div className="text-xs font-semibold text-green-800/70 flex items-center mb-2 uppercase tracking-wide">
                                <Trophy className="w-3.5 h-3.5 mr-1" />
                                Highest Score
                              </div>
                              <div className="text-4xl font-extrabold text-primary flex items-baseline gap-1">
                                {myScore.maxScore} <span className="text-sm font-medium text-primary/60">/ 100</span>
                              </div>
                              <div className="flex items-center text-xs text-primary/70 mt-2 font-mono">
                                <Clock className="w-3 h-3 mr-1" />
                                Time: {myScore.bestTime}s
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2 mt-1 bg-gray-50/80 p-4 rounded-xl border border-gray-100 flex items-center justify-center min-h-[110px]">
                              <span className="text-muted-foreground/60 text-sm font-bold tracking-widest uppercase">未受験</span>
                            </div>
                          )}
                        </CardContent>
                        <CardFooter className="flex flex-col gap-2 px-6 pb-6 pt-0">
                          <div className="flex gap-3 w-full">
                            <Button 
                              className="flex-1 shadow-md hover:shadow-lg transition-shadow bg-primary text-primary-foreground font-semibold" 
                              onClick={() => startDrill(unit.id)}
                              disabled={totalQ === 0}
                            >
                              <PlayCircle className="w-4 h-4 mr-2" />
                              演習開始
                            </Button>
                            <Button 
                              variant="outline" 
                              onClick={() => gotoRanking(unit.id)}
                              aria-label={`${displayTitle}のランキングを見る`}
                              className="border-primary/20 text-primary hover:bg-primary/5 hover:text-primary transition-colors"
                            >
                              <Trophy className="w-4 h-4" />
                            </Button>
                          </div>
                          {wrongAnswers[unit.id] > 0 && (
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
                  <p className="text-sm text-muted-foreground mt-1 ml-8">全単元の得点合計 Top 10</p>
                </div>
              </div>

              <Card className="shadow-lg border-t-4 border-t-amber-400 overflow-hidden bg-white/95">
                <CardContent className="p-0 flex flex-col">
                  {/* Highlight My Rank if available */}
                  {myRankInfo && (
                    <div className="bg-amber-100/60 border-b border-amber-200 p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                         <div className="w-10 h-10 bg-amber-500 text-white rounded-full flex items-center justify-center font-black text-lg shadow-sm">
                           {myRankInfo.rank}
                         </div>
                         <div>
                           <p className="text-xs font-bold text-amber-800 tracking-wider">あなたの総合順位</p>
                           <p className="text-xl font-black text-amber-900 leading-none mt-0.5">{myRankInfo.data.totalScore} <span className="text-xs font-medium text-amber-800/70">pts</span></p>
                         </div>
                      </div>
                    </div>
                  )}

                  {overallRanking.length === 0 ? (
                    <div className="text-center p-8 text-muted-foreground text-sm">
                      まだ誰のスコアもありません。
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {overallRanking.map((rankUser, index) => {
                        const rank = index + 1;
                        const isCurrentUser = rankUser.uid === user?.uid;
                        
                        return (
                          <div 
                            key={rankUser.uid} 
                            className={`flex items-center px-5 py-4 transition-colors ${
                              isCurrentUser ? 'bg-amber-50/50 relative' : 'hover:bg-gray-50'
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
                               <p className="text-lg font-black text-amber-600 leading-none">{rankUser.totalScore}</p>
                               <p className="text-[10px] text-gray-400 font-mono mt-1">
                                 <Clock className="w-2.5 h-2.5 inline mr-0.5" />{rankUser.totalTime}s
                               </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
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
                    className={`aspect-square text-3xl sm:text-4xl flex items-center justify-center rounded-xl transition-all ${
                      userData.icon === icon 
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
              <h3 className="text-2xl font-black text-gray-900 tracking-tight">SIT Math Sync へようこそ！</h3>
              <p className="text-sm text-muted-foreground">利用を始める前に、必ず以下の利用規約とプライバシーポリシーをお読みください。</p>
            </div>
            
            <div className="bg-gray-50 p-4 border rounded-xl text-sm text-gray-700 h-40 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              <p className="font-bold mb-2 text-primary">■ 生徒の皆さんへのお願い</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>本サービスは芝浦工業大学附属中学高等学校の生徒向け学習アプリです。</li>
                <li><strong>校則を遵守し</strong>、正しく利用してください。授業中の無許可使用や不正行為、バグを利用した意図的な稼ぎ等はデータ削除や生徒指導の対象となります。</li>
                <li>学習データは、個人が特定されない形で学術研究や公表等に活用されることがあります。</li>
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

      {/* Footer */}
      <footer className="mt-8 mb-6 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
        <div className="flex items-center justify-center">
          <a href="/terms" className="hover:underline hover:text-primary transition-colors mx-2">利用規約</a>
          |
          <a href="/privacy" className="hover:underline hover:text-primary transition-colors mx-2">プライバシーポリシー</a>
        </div>
        <div>&copy; {new Date().getFullYear()} 芝浦工業大学附属中学高等学校 数学科</div>
      </footer>
    </div>
  );
}
