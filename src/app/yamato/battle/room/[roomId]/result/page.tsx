'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { BattleScene } from '../../../BattleScene';
import styles from '../../../battle-scene.module.css';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { ArrowLeft, CheckCircle2, Clock, Medal, Swords, Trophy, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { functions, getRealtimeDb } from '@/lib/firebase';
import { BattleResultEntry, getBattleXpDelta, sortBattleResults } from '@/lib/kanjiBattle';

const KANJI_BATTLE_ROOM_PATH = 'kanjiBattleRooms';
const FINALIZE_TIMEOUT_MS = 90000;

interface QuestionResult {
  questionId: string;
  questionText: string;
  recognizedText: string;
  correctText: string;
  isCorrect: boolean;
  responseMs: number;
  baseScore: number;
  speedBonus: number;
  questionScore: number;
}

interface PlayerScore {
  score: number;
  correctCount: number;
  totalQuestions: number;
  totalTimeMs: number;
  questionResults: QuestionResult[];
}

interface BattleRoom {
  status?: 'waiting' | 'active' | 'completed' | 'cancelled';
  unitTitle?: string;
  participants?: Record<string, { uid: string; name: string; abandoned?: boolean }>;
  results?: Record<string, BattleResultEntry & { xpDelta?: number; rank?: number }>;
  playerScores?: Record<string, PlayerScore>;
  completedAt?: number;
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
  const [nowMs, setNowMs] = useState(Date.now());
  const finalizeRequestedRef = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
      const activeParticipantIds = Object.values(room.participants || {})
        .filter(participant => participant.uid && !participant.abandoned)
        .map(participant => participant.uid);
      const allHaveScores = activeParticipantIds.length > 0 && activeParticipantIds.every(uid => !!room.playerScores?.[uid]);
      const completedAt = Number(room.completedAt || 0);
      const timedOut = completedAt > 0 && (nowMs - completedAt) > FINALIZE_TIMEOUT_MS;
      if (!allHaveScores && !timedOut) return;

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
  }, [finalizing, nowMs, room, roomId, user]);

  const participants = Object.values(room?.participants || {});
  const results = useMemo(() => sortBattleResults(Object.values(room?.results || {})), [room?.results]);
  const myRankIndex = results.findIndex(result => result.uid === user?.uid);
  const finalizedMyResult = myRankIndex >= 0 ? results[myRankIndex] as BattleResultEntry & { xpDelta?: number } : null;
  const myPlayerScore = user ? room?.playerScores?.[user.uid] : undefined;
  const hasBetterPlayerScore =
    !!myPlayerScore &&
    (!finalizedMyResult ||
      (finalizedMyResult.totalScore === 0 && myPlayerScore.score > 0) ||
      (finalizedMyResult.correctCount === 0 && myPlayerScore.correctCount > 0));
  const myResult = hasBetterPlayerScore && user
    ? {
      uid: user.uid,
      name: finalizedMyResult?.name || room?.participants?.[user.uid]?.name || user.displayName || user.email || 'Player',
      totalScore: myPlayerScore.score,
      correctCount: myPlayerScore.correctCount,
      totalQuestions: myPlayerScore.totalQuestions,
      totalTimeMs: myPlayerScore.totalTimeMs,
      rank: finalizedMyResult?.rank,
      xpDelta: finalizedMyResult?.xpDelta,
    } as BattleResultEntry & { xpDelta?: number }
    : finalizedMyResult;
  const myXpDelta = myResult?.xpDelta ?? (myRankIndex >= 0 ? getBattleXpDelta(Math.max(2, participants.length), myRankIndex) : 0);
  const myRank = myResult?.rank ?? (myRankIndex >= 0 ? myRankIndex + 1 : null);
  const allSubmitted = participants.length > 0 && results.length >= participants.length;
  const myQuestionResults: QuestionResult[] = myPlayerScore?.questionResults || [];

  return (
    <BattleScene variant="result">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <div className="flex justify-between items-center gap-3">
          <p className={styles.eyebrow}>KANJI ARENA / RESULT</p>
          <Button variant="ghost" onClick={() => router.push('/yamato/battle')} className="text-muted-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            対戦トップへ
          </Button>
        </div>
        <header className={styles.ceremony}>
          <Trophy className={styles.ceremonyIcon} aria-hidden="true" />
          <p className={styles.eyebrow}>{room?.finalizedAt ? myRank === 1 && !finalizedMyResult?.abandoned ? 'VICTORY' : 'BATTLE COMPLETE' : 'BATTLE RESULT'}</p>
          <h1 className={styles.heading}>対戦結果</h1>
          <p className={styles.subtitle}>{room?.unitTitle || '漢字対戦'}</p>
        </header>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#526052] border-t-amber-500" />
          </div>
        ) : !room ? (
          <div className="rounded-2xl border border-dashed border-[#526976] bg-[#172d3b] p-12 text-center text-sm font-bold text-muted-foreground">
            ルームが見つかりません。
          </div>
        ) : (
          <>
            {/* 自分のサマリー */}
            <div className="rounded-2xl border border-[#526052] bg-[#172d3b] p-5 shadow-sm">
              <div className={styles.summary}>
                <div className="rounded-xl bg-[#2c3b40] p-4">
                  <p className="text-xs font-bold text-[#f3d593]">あなたの順位</p>
                  <p className="mt-1 text-3xl font-black text-[#f0f4f7]">{myRank ? `${myRank}位` : '-'}</p>
                </div>
                <div className="rounded-xl bg-[#132733] p-4">
                  <p className="text-xs font-bold text-muted-foreground">スコア</p>
                  <p className="mt-1 text-3xl font-black text-[#f0f4f7]">{myResult?.totalScore ?? '-'}</p>
                </div>
                <div className="rounded-xl bg-[#132733] p-4">
                  <p className="text-xs font-bold text-muted-foreground">正答率</p>
                  <p className="mt-1 text-3xl font-black text-[#f0f4f7]">
                    {myResult ? `${Math.round((myResult.correctCount / Math.max(1, myResult.totalQuestions)) * 100)}%` : '-'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#132733] p-4">
                  <p className="text-xs font-bold text-muted-foreground">対戦XP</p>
                  <p className={`mt-1 text-3xl font-black ${myXpDelta >= 0 ? 'text-[#a5ebc6]' : 'text-[#ffb5b5]'}`}>
                    {myRankIndex >= 0 ? `${myXpDelta >= 0 ? '+' : ''}${myXpDelta}` : '-'}
                  </p>
                </div>
              </div>
              {!allSubmitted && (
                <div className="mt-4 rounded-xl border border-[#526052] bg-[#2c3b40] p-3 text-sm font-bold text-[#f3d593]">
                  {finalizing ? '結果を集計しています...' : `結果を待っています ${results.length}/${participants.length}`}
                </div>
              )}
              {finalizeError && (
                <div className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-700">
                  {finalizeError}
                </div>
              )}
            </div>

            {/* ランキング */}
            <div className="rounded-2xl border border-[#526052] bg-[#172d3b] p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Swords className="h-5 w-5 text-[#efc97c]" />
                <h2 className="text-lg font-black text-[#f0f4f7]">ランキング</h2>
              </div>
              <div className="space-y-3">
                {results.map((result, index) => {
                  const resultWithXp = result as BattleResultEntry & { xpDelta?: number };
                  const xpDelta = resultWithXp.xpDelta ?? getBattleXpDelta(Math.max(2, participants.length), index);
                  return (
                    <div
                      key={result.uid}
                      className={`${styles.rankingRow} grid gap-3 rounded-xl border p-4 items-center ${
                        result.uid === user?.uid ? 'border-[#c9a969] bg-[#2c3b40]' : 'border-[#38505f] bg-[#172d3b]'
                      }`}
                    >
                      <div className="text-center text-lg font-black text-[#c5d4dd]">
                        {result.rank && result.rank <= 3 && !result.abandoned ? (
                          <><Medal aria-hidden="true" className={`mx-auto h-6 w-6 ${result.rank === 1 ? 'text-[#f3d593]' : result.rank === 2 ? 'text-[#bacbd7]' : 'text-[#f3d593]'}`} /><span className="mt-1 block text-xs">{result.rank}位</span></>
                        ) : `${result.rank ?? index + 1}位`}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-[#f0f4f7]">{result.name}</p>
                        <p className="text-xs font-bold text-muted-foreground">
                          {result.abandoned ? '離脱' : `${result.correctCount}/${result.totalQuestions}問正解`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-black text-[#f0f4f7]">
                        <CheckCircle2 className="h-4 w-4 text-[#a5ebc6]" />
                        {Math.round((result.correctCount / Math.max(1, result.totalQuestions)) * 100)}%
                      </div>
                      <div className="flex items-center gap-2 text-sm font-black text-[#f0f4f7]">
                        <Clock className="h-4 w-4 text-[#efc97c]" />
                        {Math.round(result.totalTimeMs / 1000)}秒
                      </div>
                      <div className="text-right text-lg font-black text-[#f0f4f7]">
                        {result.totalScore}点
                        <p className={`text-xs ${xpDelta >= 0 ? 'text-[#a5ebc6]' : 'text-[#ffb5b5]'}`}>
                          XP {xpDelta >= 0 ? '+' : ''}{xpDelta}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 問題別スコア内訳 */}
            {myQuestionResults.length > 0 && (
              <div className="rounded-2xl border border-[#526052] bg-[#172d3b] p-5 shadow-sm">
                <h2 className="mb-4 text-lg font-black text-[#f0f4f7]">問題別スコア</h2>
                <div className="space-y-2">
                  {myQuestionResults.map((qr, idx) => (
                    <div
                      key={qr.questionId}
                      className={`grid gap-2 rounded-xl border p-4 sm:grid-cols-[32px_minmax(0,1fr)_auto] sm:items-center ${
                        qr.isCorrect ? 'border-[#406e58] bg-[#17392f]' : 'border-[#38505f] bg-[#132733]'
                      }`}
                    >
                      <div className="flex items-center justify-center">
                        {qr.isCorrect
                          ? <CheckCircle2 className="h-5 w-5 text-[#a5ebc6]" />
                          : <XCircle className="h-5 w-5 text-[#ffb5b5]" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-muted-foreground mb-0.5">Q{idx + 1}</p>
                        <p
                          className="break-words text-sm font-bold text-[#f0f4f7]"
                          dangerouslySetInnerHTML={{ __html: qr.questionText }}
                        />
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground font-semibold">
                          <span>認識: <span className={qr.isCorrect ? 'text-[#a5ebc6]' : 'text-[#ffb5b5]'}>{qr.recognizedText}</span></span>
                          {!qr.isCorrect && <span>正解: <span className="text-[#c5d4dd]">{qr.correctText}</span></span>}
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{(qr.responseMs / 1000).toFixed(1)}秒</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-black text-[#f0f4f7]">{qr.questionScore}点</p>
                        <p className="text-xs text-muted-foreground font-semibold">
                          基礎 {qr.baseScore}
                          {qr.isCorrect && <span className="ml-1 text-[#efc97c]">+ 速度 {qr.speedBonus}</span>}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </>
        )}
        {!loading && room && <Button className="min-h-12 self-center px-8 font-bold" onClick={() => router.push('/yamato/battle')}><Swords className="mr-2 h-4 w-4" />次の対戦へ</Button>}
      </main>
    </BattleScene>
  );
}
