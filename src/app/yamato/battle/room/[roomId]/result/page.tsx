'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { ArrowLeft, CheckCircle2, Clock, Medal, Swords, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { functions, getRealtimeDb } from '@/lib/firebase';
import { BattleResultEntry, KANJI_BATTLE_ACCESS_STORAGE_KEY, getBattleXpDelta, sortBattleResults } from '@/lib/battle';

const KANJI_BATTLE_ROOM_PATH = 'kanjiBattleRooms';

interface BattleRoom {
  status?: 'waiting' | 'active' | 'completed' | 'cancelled';
  unitTitle?: string;
  participants?: Record<string, { uid: string; name: string; abandoned?: boolean }>;
  results?: Record<string, BattleResultEntry & { xpDelta?: number; rank?: number }>;
  finalizedAt?: number;
}

export default function KanjiBattleResultPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const roomId = String(params.roomId || '');
  const [room, setRoom] = useState<BattleRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const finalizeRequestedRef = useRef(false);

  useEffect(() => {
    if (sessionStorage.getItem(KANJI_BATTLE_ACCESS_STORAGE_KEY) !== 'true') {
      router.replace('/yamato/battle');
    }
  }, [router]);

  useEffect(() => {
    if (!roomId) return;
    const realtimeDb = getRealtimeDb();
    const roomRef = ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      setRoom(snapshot.exists() ? snapshot.val() : null);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [roomId]);

  useEffect(() => {
    async function finalizeIfNeeded() {
      if (!user || !room || room.status !== 'completed' || !room.participants?.[user.uid] || room.finalizedAt || finalizing || finalizeRequestedRef.current) return;
      finalizeRequestedRef.current = true;
      setFinalizing(true);
      setFinalizeError(null);
      try {
        const finalizeKanjiBattleRoom = httpsCallable(functions, 'finalizeKanjiBattleRoom');
        await finalizeKanjiBattleRoom({ roomId });
      } catch (err) {
        console.error('Failed to finalize kanji battle room:', err);
        finalizeRequestedRef.current = false;
        setFinalizeError('結果の集計に失敗しました。少し待ってから結果画面を開き直してください。');
      } finally {
        setFinalizing(false);
      }
    }

    finalizeIfNeeded();
  }, [finalizing, room, roomId, user]);

  const participants = Object.values(room?.participants || {});
  const results = useMemo(() => sortBattleResults(Object.values(room?.results || {})), [room?.results]);
  const myRankIndex = results.findIndex(result => result.uid === user?.uid);
  const myResult = myRankIndex >= 0 ? results[myRankIndex] as BattleResultEntry & { xpDelta?: number } : null;
  const myXpDelta = myResult?.xpDelta ?? (myRankIndex >= 0 ? getBattleXpDelta(Math.max(2, participants.length), myRankIndex) : 0);
  const myRank = myResult?.rank ?? (myRankIndex >= 0 ? myRankIndex + 1 : null);
  const allSubmitted = participants.length > 0 && results.length >= participants.length;

  return (
    <div className="min-h-screen bg-[#F8FAEB] p-4 md:p-8">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <div className="flex flex-col gap-4 rounded-2xl border border-amber-100 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Trophy className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-gray-900">対戦結果</h1>
              <p className="text-xs font-semibold text-muted-foreground">{room?.unitTitle || '漢字対戦'} / Room ID: {roomId}</p>
            </div>
          </div>
          <Button variant="ghost" onClick={() => router.push('/yamato/battle')} className="justify-start text-muted-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            対戦トップへ
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-100 border-t-amber-500" />
          </div>
        ) : !room ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white/70 p-12 text-center text-sm font-bold text-muted-foreground">
            ルームが見つかりません。
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-amber-50 p-4">
                  <p className="text-xs font-bold text-amber-700">あなたの順位</p>
                  <p className="mt-1 text-3xl font-black text-gray-900">{myRank ? `${myRank}位` : '-'}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-xs font-bold text-muted-foreground">スコア</p>
                  <p className="mt-1 text-3xl font-black text-gray-900">{myResult?.totalScore ?? '-'}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-xs font-bold text-muted-foreground">正答率</p>
                  <p className="mt-1 text-3xl font-black text-gray-900">
                    {myResult ? `${Math.round((myResult.correctCount / Math.max(1, myResult.totalQuestions)) * 100)}%` : '-'}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-xs font-bold text-muted-foreground">対戦XP</p>
                  <p className={`mt-1 text-3xl font-black ${myXpDelta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {myRankIndex >= 0 ? `${myXpDelta >= 0 ? '+' : ''}${myXpDelta}` : '-'}
                  </p>
                </div>
              </div>
              {!allSubmitted && (
                <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm font-bold text-amber-800">
                  {finalizing ? '結果を集計しています...' : `結果を待っています ${results.length}/${participants.length}`}
                </div>
              )}
              {finalizeError && (
                <div className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-700">
                  {finalizeError}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Swords className="h-5 w-5 text-amber-500" />
                <h2 className="text-lg font-black text-gray-900">ランキング</h2>
              </div>
              <div className="space-y-3">
                {results.map((result, index) => {
                  const resultWithXp = result as BattleResultEntry & { xpDelta?: number };
                  const xpDelta = resultWithXp.xpDelta ?? getBattleXpDelta(Math.max(2, participants.length), index);
                  return (
                    <div
                      key={result.uid}
                      className={`grid gap-3 rounded-xl border p-4 sm:grid-cols-[64px_minmax(0,1fr)_120px_120px_120px] sm:items-center ${
                        result.uid === user?.uid ? 'border-amber-300 bg-amber-50' : 'border-gray-100 bg-white'
                      }`}
                    >
                      <div className="text-center text-lg font-black text-gray-700">
                        {result.rank && result.rank <= 3 && !result.abandoned ? (
                          <Medal className={`mx-auto h-6 w-6 ${result.rank === 1 ? 'text-yellow-500' : result.rank === 2 ? 'text-gray-400' : 'text-amber-700'}`} />
                        ) : `${result.rank ?? index + 1}位`}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-gray-900">{result.name}</p>
                        <p className="text-xs font-bold text-muted-foreground">
                          {result.abandoned ? '離脱' : `${result.correctCount}/${result.totalQuestions}問正解`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-black text-gray-800">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        {Math.round((result.correctCount / Math.max(1, result.totalQuestions)) * 100)}%
                      </div>
                      <div className="flex items-center gap-2 text-sm font-black text-gray-800">
                        <Clock className="h-4 w-4 text-amber-500" />
                        {Math.round(result.totalTimeMs / 1000)}秒
                      </div>
                      <div className="text-right text-lg font-black text-gray-900">
                        {result.totalScore}点
                        <p className={`text-xs ${xpDelta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          XP {xpDelta >= 0 ? '+' : ''}{xpDelta}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
