'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onValue, ref } from 'firebase/database';
import { useAuth } from '@/contexts/AuthContext';
import { getRealtimeDb } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { kanjiBattleCall, kanjiBattleError, KanjiBattleRoom } from '@/lib/kanjiBattle';
import { useBattleClock } from '@/hooks/useBattleClock';

export default function KanjiBattleRoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [room, setRoom] = useState<KanjiBattleRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [prepared, setPrepared] = useState(false);
  const [retry, setRetry] = useState(0);
  const { nowMs, synchronized } = useBattleClock();
  const advanceAt = useRef(0);

  useEffect(() => {
    if (!user) return;
    return onValue(ref(getRealtimeDb(), 'kanjiBattleRooms/' + roomId), snap => {
      const value = snap.val() as KanjiBattleRoom | null;
      setRoom(value); setLoading(false);
      if (value?.status === 'active') router.replace('/yamato/battle/room/' + roomId + '/play');
      if (value?.status === 'completed') router.replace('/yamato/battle/room/' + roomId + '/result');
    }, () => { setError('ルームに参加していないか、募集が終了しました。一覧から選び直してください。'); setLoading(false); });
  }, [roomId, user, router]);

  const matchId = room?.matchId;
  const isMember = !!user && !!room?.participants?.[user.uid] && !room.participants[user.uid].abandoned;
  useEffect(() => {
    if (!user || !matchId || !isMember) return;
    let cancelled = false;
    setPrepared(false);
    kanjiBattleCall<{ questions: unknown[] }>('getKanjiBattleQuestions', { roomId }).then(result => {
      if (cancelled) return;
      if (result.questions.length !== 10) throw new Error('10問以上の単元で作り直してください。');
      sessionStorage.setItem('kanji_battle_questions:v2:' + roomId + ':' + user.uid, JSON.stringify(result.questions));
      setPrepared(true);
    }).catch(err => { if (!cancelled) setError(kanjiBattleError(err)); });
    return () => { cancelled = true; };
  }, [roomId, user, matchId, isMember, retry]);

  useEffect(() => {
    if (!room || !isMember || !synchronized || !room.phaseDeadlineMs || nowMs < room.phaseDeadlineMs || nowMs < advanceAt.current) return;
    advanceAt.current = nowMs + 2000;
    void kanjiBattleCall('advanceKanjiBattleRoom', { roomId, matchId: room.matchId, version: room.version }).catch(err => setError(kanjiBattleError(err)));
  }, [room, roomId, isMember, nowMs, synchronized]);

  const run = async (name: string, extra: Record<string, unknown> = {}) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await kanjiBattleCall(name, { roomId, ...extra }); return true; }
    catch (err) { setError(kanjiBattleError(err)); return false; }
    finally { setBusy(false); }
  };
  const leave = async () => {
    if (isMember && room?.schemaVersion === 2 && room.status !== 'cancelled') {
      if (!await run('leaveKanjiBattleRoom')) return;
    }
    sessionStorage.removeItem('kanji-battle-current-room');
    router.push('/yamato/battle');
  };
  const players = Object.values(room?.participants || {}).filter(p => !p.abandoned);
  const me = user ? room?.participants?.[user.uid] : undefined;
  const waiting = room?.status === 'waiting' && room.phase === 'waiting';
  const canStart = waiting && players.length >= 2 && players.length <= 4 && players.every(p => p.ready && p.questionsReady);
  return (
    <div className="min-h-screen bg-[#F8FAEB] p-4 md:p-8">
      <main className="mx-auto max-w-3xl space-y-5">
        <Button variant="ghost" disabled={busy} onClick={leave}>{room?.hostUid === user?.uid ? 'ルームを解散して戻る' : '退出して戻る'}</Button>
        {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}
          {isMember && !prepared && <Button variant="outline" onClick={() => { setError(null); setRetry(v => v + 1); }}>問題の読み込みを再試行</Button>}
        </div>}
        {loading ? <p role="status">ルームを読み込んでいます…</p> : room?.schemaVersion !== 2 ? <p>新しい対戦方式に更新されました。一覧から新しいルームに参加してください。</p>
          : room.status === 'cancelled' ? <p>ルームは解散されました。</p> : (
          <Card><CardHeader><CardTitle>{room.unitTitle}</CardTitle><p>参加者 {players.length}/4人・10問</p></CardHeader>
            <CardContent className="space-y-5">
              <ul className="space-y-3">{players.map(p => <li key={p.uid} className="flex justify-between rounded-xl bg-amber-50 p-4">
                <span>{p.name}{p.uid === room.hostUid ? '（ホスト）' : ''}</span><span>{p.ready ? '準備完了' : p.questionsReady ? '待機中' : '問題を読み込み中'}</span>
              </li>)}</ul>
              {room.phase === 'starting' ? <p role="status" className="text-center text-2xl font-bold">{synchronized ? `開始まで ${Math.max(0, Math.ceil(((room.phaseDeadlineMs || 0) - nowMs) / 1000))}秒` : '時刻を確認しています…'}</p> : (
                <div className="flex flex-wrap gap-3">
                  <Button disabled={busy || !prepared || !waiting || !isMember || !synchronized} onClick={() => run('readyKanjiBattleRoom', { ready: !me?.ready })}>{me?.ready ? '準備を取り消す' : '準備完了'}</Button>
                  {room.hostUid === user?.uid && <Button disabled={busy || !canStart || !synchronized} onClick={() => run('startKanjiBattleRoom')}>対戦を開始</Button>}
                </div>
              )}
              <p className="text-sm text-muted-foreground">2〜4人全員の準備が完了したら、ホストが対戦を開始します。</p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
