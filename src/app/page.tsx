'use client';

import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { LogOut, PlayCircle, Trophy, Clock } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

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

export default function Home() {
  const { user, logout } = useAuth();
  const [units, setUnits] = useState<Unit[]>([]);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function fetchData() {
      if (!user) return;
      try {
        // 1. Fetch units
        const unitsSnap = await getDocs(collection(db, 'units'));
        const unitsData = unitsSnap.docs.map(doc => doc.data() as Unit);
        
        // 2. Fetch user's best scores
        const newScores: Record<string, Score> = {};
        for (const unit of unitsData) {
          const scoreId = `${user.uid}_${unit.id}`;
          const scoreSnap = await getDoc(doc(db, 'scores', scoreId));
          if (scoreSnap.exists()) {
            newScores[unit.id] = scoreSnap.data() as Score;
          }
        }

        setUnits(unitsData);
        setScores(newScores);
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <h1 className="text-xl font-bold text-primary">数学学習演習</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-foreground hidden sm:inline-block">
            {user?.displayName} さん
          </span>
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut className="w-4 h-4 mr-2" />
            ログアウト
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6 max-w-5xl mx-auto w-full">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold">単元一覧・ダッシュボード</h2>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full font-bold"></div>
          </div>
        ) : units.length === 0 ? (
           <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-12 text-muted-foreground">
              <p>利用可能な単元がありません。</p>
              {user?.email === 'kazuki2kr@gmail.com' && (
                <Button variant="link" onClick={() => router.push('/admin')}>
                  管理画面でCSVアップロード
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {units.map((unit) => {
              const myScore = scores[unit.id];
              const totalQ = unit.questions?.length || 0;
              const hasPlayed = !!myScore;

              return (
                <Card key={unit.id} className="flex flex-col hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xl">{unit.title}</CardTitle>
                    <CardDescription>総問題数: {totalQ}問</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 pb-4">
                    {hasPlayed ? (
                      <div className="space-y-2 mt-2 bg-green-50/50 p-3 rounded-lg border border-green-100">
                        <div className="text-sm text-muted-foreground flex items-center mb-1">
                          <Trophy className="w-4 h-4 mr-1 text-amber-500" />
                          あなたの最高得点
                        </div>
                        <div className="text-3xl font-bold text-green-700">
                          {myScore.maxScore} <span className="text-lg font-normal text-green-600/70">/ 100点</span>
                        </div>
                        <div className="flex items-center text-xs text-muted-foreground mt-1">
                          <Clock className="w-3 h-3 mr-1" />
                          解答時間: {myScore.bestTime}秒
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 mt-2 bg-gray-50 p-3 rounded-lg border border-gray-100 flex items-center justify-center min-h-[100px]">
                        <p className="text-muted-foreground text-sm font-medium">未受験</p>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="flex gap-2 pt-0">
                    <Button 
                      className="flex-1" 
                      onClick={() => startDrill(unit.id)}
                      disabled={totalQ === 0}
                    >
                      <PlayCircle className="w-4 h-4 mr-2" />
                      演習開始
                    </Button>
                    <Button 
                      variant="secondary" 
                      onClick={() => gotoRanking(unit.id)}
                      aria-label={`${unit.title}のランキングを見る`}
                    >
                      <Trophy className="w-4 h-4" />
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
