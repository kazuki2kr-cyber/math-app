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
import { CheckCircle2, Users } from 'lucide-react';
import { BattleScene } from '../../BattleScene';
import styles from '../../battle-scene.module.css';

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
    <BattleScene variant="lobby">
      <main className="mx-auto max-w-3xl space-y-5">
        <Button variant="ghost" disabled={busy} onClick={leave}>{room?.hostUid === user?.uid ? 'ルームを解散して戻る' : '退出して戻る'}</Button>
        <header className={styles.lobbyHeader}>
          <p className={styles.eyebrow}>MATCH LOBBY</p>
          <h1 className={styles.heading}>準備ができたら、いざ勝負。</h1>
          <p className={styles.subtitle}>用意ができたら「準備完了」。全員の準備後、ホストが対戦を開始します。</p>
        </header>
        {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}
          {isMember && !prepared && <Button variant="outline" onClick={() => { setError(null); setRetry(v => v + 1); }}>問題の読み込みを再試行</Button>}
        </div>}
        {loading ? <p role="status">ルームを読み込んでいます…</p> : room?.schemaVersion !== 2 ? <p>新しい対戦方式に更新されました。一覧から新しいルームに参加してください。</p>
          : room.status === 'cancelled' ? <p>ルームは解散されました。</p> : (
          <Card className={styles.panel}><CardHeader><CardTitle className="text-xl font-bold">{room.unitTitle}</CardTitle><p className="text-sm text-muted-foreground">参加者 {players.length}/4人・10問</p></CardHeader>
            <CardContent className="space-y-5">
              <ul className={styles.players}>{players.map(p => <li key={p.uid} className={`${styles.player} ${p.ready ? styles.playerReady : ''}`}>
                <span className={styles.avatar} aria-hidden="true">{Array.from(p.name || '友')[0]}</span>
                <div className="min-w-0"><p className={styles.playerName}>{p.name}{p.uid === room.hostUid ? '（ホスト）' : ''}{p.uid === user?.uid ? '・あなた' : ''}</p>
                  <p className={styles.playerStatus}>{p.ready && <CheckCircle2 size={14} aria-hidden="true" />}{p.ready ? '準備完了' : p.questionsReady ? '待機中' : '問題を読み込み中'}</p>
                </div>
              </li>)}{Array.from({ length: Math.max(0, 4 - players.length) }, (_, index) => <li key={`empty-${index}`} className={`${styles.player} ${styles.emptyPlayer}`}>
                <span className={styles.avatar}><Users size={20} aria-hidden="true" /></span><span className="text-sm">参加者を待っています</span>
              </li>)}</ul>
              {room.phase === 'starting' ? <p role="status" className={`${styles.status} text-2xl font-bold`}>{synchronized ? `開始まで ${Math.max(0, Math.ceil(((room.phaseDeadlineMs || 0) - nowMs) / 1000))}秒` : '時刻を確認しています…'}</p> : (
                <div className={styles.roomActions}>
                  <Button disabled={busy || !prepared || !waiting || !isMember || !synchronized} onClick={() => run('readyKanjiBattleRoom', { ready: !me?.ready })}>{me?.ready ? '準備を取り消す' : '準備完了'}</Button>
                  {room.hostUid === user?.uid && <Button disabled={busy || !canStart || !synchronized} onClick={() => run('startKanjiBattleRoom')}>対戦を開始</Button>}
                </div>
              )}
              <p className="text-sm text-muted-foreground">2〜4人全員の準備が完了したら、ホストが対戦を開始します。</p>
            </CardContent>
          </Card>
        )}
      </main>
    </BattleScene>
  );
}
