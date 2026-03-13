'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, limit, doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ArrowLeft, Trophy, Medal, Clock } from 'lucide-react';
import { calculateLevelAndProgress } from '@/lib/xp';

interface ScoreEntry {
  uid: string;
  name: string; // fallback if user doc fetch fails, but usually we fetch users
  maxScore: number;
  bestTime: number;
  updatedAt: string;
  icon?: string;
  level?: number;
}

export default function RankingPage() {
  const params = useParams();
  // Decode the URL parameter explicitly
  const unitId = decodeURIComponent(params.unitId as string);
  const router = useRouter();
  const { user } = useAuth();
  
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitTitle, setUnitTitle] = useState(unitId);

  useEffect(() => {
    async function fetchRanking() {
      if (!unitId) return;
      try {
        // Fetch Unit info
        const unitSnap = await getDoc(doc(db, 'units', unitId));
        if (unitSnap.exists()) {
          const rawTitle = unitSnap.data().title || unitId;
          setUnitTitle(rawTitle.replace(/^単元\s*/, ''));
        }

        // Fetch top scores for this unit
        // NOTE: Firestore requires an index for multiple orderBy (maxScore desc, bestTime asc).
        // Since we may not have the index yet, we will fetch top 50 by maxScore and sort locally.
        const q = query(
          collection(db, 'scores'),
          where('unitId', '==', unitId),
          orderBy('maxScore', 'desc'),
          limit(50)
        );

        const snap = await getDocs(q);
        const data = snap.docs.map(doc => doc.data());

        // Client-side sort: higher maxScore first, then lower bestTime
        data.sort((a, b) => {
          if (b.maxScore !== a.maxScore) {
            return b.maxScore - a.maxScore;
          }
          return a.bestTime - b.bestTime;
        });

        // Take top 10
        const top10Data = data.slice(0, 10);
        
        const top10 = await Promise.all(top10Data.map(async scoreObj => {
          const uDoc = await getDoc(doc(db, 'users', scoreObj.uid));
          let icon = '📐';
          let level = 1;
          if (uDoc.exists()) {
             const uData = uDoc.data();
             icon = uData.icon || '📐';
             level = calculateLevelAndProgress(uData.xp || 0).level;
          }
          return {
            uid: scoreObj.uid,
            name: scoreObj.userName || '名無し',
            maxScore: scoreObj.maxScore,
            bestTime: scoreObj.bestTime,
            updatedAt: scoreObj.updatedAt,
            icon,
            level
          };
        }));

        setScores(top10);
      } catch (err) {
        console.error("Error fetching ranking:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchRanking();
  }, [unitId]);

  return (
    <div className="min-h-screen bg-[#F8FAEB] flex flex-col p-4 md:p-8">
      <div className="max-w-3xl mx-auto w-full space-y-6">
        <Button variant="ghost" onClick={() => router.push('/')} className="mb-2 text-muted-foreground hover:bg-white/50 hover:text-primary transition-colors">
          <ArrowLeft className="w-4 h-4 mr-2" />
          ダッシュボードへ戻る
        </Button>
        
        <div className="flex items-center space-x-3">
          <Trophy className="w-8 h-8 text-amber-500" />
          <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">ランキング: {unitTitle}</h2>
        </div>

        <Card className="shadow-lg border-t-4 border-t-amber-400 overflow-hidden bg-white/95">
          <CardHeader className="bg-white rounded-t-lg border-b px-6 py-5">
            <CardTitle className="text-lg flex justify-between items-center text-gray-800">
              <span className="font-bold flex items-center gap-2">上位10名の記録</span>
              <span className="text-sm text-muted-foreground font-normal bg-gray-100 px-3 py-1 rounded-full">同点の場合はタイムが短い順</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center p-12">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
              </div>
            ) : scores.length === 0 ? (
              <div className="text-center p-12 text-muted-foreground">
                まだこの単元の記録はありません。あなたが1位になるチャンスです！
              </div>
            ) : (
              <div className="divide-y">
                {scores.map((s, index) => {
                  const rank = index + 1;
                  const isCurrentUser = s.uid === user?.uid;
                  
                  return (
                    <div 
                      key={s.uid} 
                      className={`flex items-center justify-between p-4 transition-colors ${
                        isCurrentUser ? 'bg-primary/5 border-l-4 border-primary' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center space-x-3 sm:space-x-4">
                        <div className="w-8 sm:w-10 text-center font-bold text-xl flex justify-center flex-shrink-0">
                          {rank === 1 ? <Medal className="text-yellow-500 w-8 h-8 filter drop-shadow" /> :
                           rank === 2 ? <Medal className="text-gray-400 w-7 h-7 filter drop-shadow" /> :
                           rank === 3 ? <Medal className="text-amber-700 w-7 h-7 filter drop-shadow" /> :
                           <span className="text-muted-foreground">{rank}</span>}
                        </div>
                        <div className="text-3xl filter drop-shadow hover:scale-110 transition-transform hidden sm:block text-center w-10">
                          {s.icon}
                        </div>
                        <div>
                          <p className="font-bold text-sm sm:text-lg text-gray-800 flex items-center min-w-0">
                            <span className="text-xl sm:hidden mr-1.5">{s.icon}</span>
                            <span className="truncate max-w-[120px] sm:max-w-[200px]">{s.name}</span>
                            {isCurrentUser && <span className="ml-2 text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0">You</span>}
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono font-semibold">Lv.{s.level || 1}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-6 text-right">
                        <div>
                          <p className="text-sm text-muted-foreground mb-1 flex items-center justify-end"><Clock className="w-3 h-3 mr-1"/> タイム</p>
                          <p className="font-mono">{s.bestTime}秒</p>
                        </div>
                        <div className="w-20">
                          <p className="text-sm text-muted-foreground mb-1">スコア</p>
                          <p className="font-bold text-xl text-primary">{s.maxScore}</p>
                        </div>
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
  );
}
