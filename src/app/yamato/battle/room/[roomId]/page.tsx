'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onDisconnect, onValue, ref, remove, serverTimestamp, update } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { ArrowLeft, CheckCircle2, Copy, Flame, Play, Swords, Users, XCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { functions, getRealtimeDb } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const KANJI_BATTLE_ROOM_PATH = 'kanjiBattleRooms';

interface Participant {
  uid: string;
  name: string;
  connected?: boolean;
  abandoned?: boolean;
  ready?: boolean;
  questionsReady?: boolean;
  playReady?: boolean;
}

interface BattleRoom {
  status?: 'waiting' | 'active' | 'completed' | 'cancelled';
  phase?: 'loading' | 'answering' | 'countdown' | 'completed' | 'starting';
  countdownStartedAtMs?: number | null;
  unitId?: string;
  unitTitle?: string;
  subject?: string;
  category?: string;
  hostUid?: string;
  participants?: Record<string, Participant>;
}

export default function KanjiBattleRoomPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const roomId = String(params.roomId || '');
  const [room, setRoom] = useState<BattleRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [preloadingQuestions, setPreloadingQuestions] = useState(false);
  const [preloadError, setPreloadError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const preloadedQuestionsKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!roomId) return;
    const realtimeDb = getRealtimeDb();
    const roomRef = ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const nextRoom = snapshot.exists() ? snapshot.val() : null;
      setRoom(nextRoom);
      setLoading(false);
      if (nextRoom?.status === 'active') router.replace(`/yamato/battle/room/${roomId}/play`);
    });

    return () => unsubscribe();
  }, [roomId, router]);

  useEffect(() => {
    async function preloadBattleQuestions() {
      if (!user || !room?.unitId || !room.participants?.[user.uid] || room.status !== 'waiting') return;
      if (!room.participants[user.uid]?.ready) return;
      const preloadKey = `${roomId}:${user.uid}:${room.unitId}`;
      if (room.participants[user.uid]?.questionsReady || preloadingQuestions || preloadedQuestionsKeyRef.current === preloadKey) return;
      preloadedQuestionsKeyRef.current = preloadKey;
      setPreloadingQuestions(true);
      setPreloadError(null);
      try {
        const getKanjiBattleQuestions = httpsCallable<{ roomId: string }, { questions: unknown[] }>(functions, 'getKanjiBattleQuestions');
        const response = await getKanjiBattleQuestions({ roomId });
        sessionStorage.setItem(`kanji_battle_questions:${roomId}`, JSON.stringify(response.data.questions || []));
        const realtimeDb = getRealtimeDb();
        await update(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}/participants/${user.uid}`), {
          uid: user.uid,
          name: user.displayName || user.email || room.participants[user.uid]?.name || 'Player',
          connected: true,
          abandoned: false,
          questionsReady: true,
          playReady: false,
        });
      } catch (err) {
        console.error('Failed to preload kanji battle questions:', err);
        setPreloadError(err instanceof Error ? err.message : '問題を読み込めませんでした。別の範囲でルームを作り直してください。');
      } finally {
        setPreloadingQuestions(false);
      }
    }

    preloadBattleQuestions();
  }, [preloadingQuestions, room, roomId, user]);

  useEffect(() => {
    if (!roomId || !user) return;
    const realtimeDb = getRealtimeDb();
    const disconnectAction = onDisconnect(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}/participants/${user.uid}`));
    disconnectAction.update({
      uid: user.uid,
      name: user.displayName || user.email || 'Player',
      connected: false,
      abandoned: true,
      abandonedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return () => {
      disconnectAction.cancel();
    };
  }, [roomId, user]);

  const participants = Object.values(room?.participants || {});
  const activeParticipants = participants.filter(participant => !participant.abandoned);
  const isHost = !!user && room?.hostUid === user.uid;
  const currentParticipant = user ? room?.participants?.[user.uid] : null;
  const allReady = activeParticipants.length >= 2 && activeParticipants.every(participant => participant.ready);
  const allQuestionsReady = activeParticipants.length >= 2 && activeParticipants.every(participant => participant.questionsReady);
  const isStartingCountdown = room?.status === 'waiting' && room?.phase === 'starting';
  const startingRemainingMs = Math.max(0, 3000 - Math.max(0, nowMs - Number(room?.countdownStartedAtMs || nowMs)));
  const startingRemainingSeconds = Math.max(1, Math.ceil(startingRemainingMs / 1000));

  const copyRoomId = async () => {
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const startBattle = async () => {
    if (!isHost || !room || activeParticipants.length < 2 || starting) return;
    if (!allReady || !allQuestionsReady) return;
    setStarting(true);
    try {
      const realtimeDb = getRealtimeDb();
      await update(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}`), {
        status: 'waiting',
        phase: 'starting',
        countdownStartedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
      });
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (!isHost || !isStartingCountdown || startingRemainingMs > 0) return;
    const realtimeDb = getRealtimeDb();
    update(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}`), {
      status: 'active',
      currentQuestionIndex: 0,
      phase: 'loading',
      questionStartedAtMs: null,
      countdownStartedAtMs: null,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }, [isHost, isStartingCountdown, roomId, startingRemainingMs]);

  const toggleReady = async () => {
    if (!user || !room || room.status !== 'waiting' || isStartingCountdown) return;
    const nextReady = !currentParticipant?.ready;
    if (nextReady && !currentParticipant?.questionsReady) {
      preloadedQuestionsKeyRef.current = null;
      setPreloadError(null);
    }
    const realtimeDb = getRealtimeDb();
    await update(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}/participants/${user.uid}`), {
      uid: user.uid,
      name: user.displayName || user.email || currentParticipant?.name || 'Player',
      connected: true,
      abandoned: false,
      ready: nextReady,
    });
  };

  const cancelRoom = async () => {
    if (!isHost) return;
    const realtimeDb = getRealtimeDb();
    await remove(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}`));
  };

  return (
    <div className="min-h-screen bg-[#F8FAEB] p-4 md:p-8">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="flex items-center justify-between rounded-2xl border border-amber-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Swords className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-gray-900">対戦ルーム</h1>
              <p className="text-xs font-semibold text-muted-foreground">{roomId}</p>
            </div>
          </div>
          <Button variant="ghost" onClick={() => router.push('/yamato/battle')} className="text-muted-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            戻る
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
          <Card className="border-transparent bg-white shadow-sm">
            {isStartingCountdown && (
              <div className="relative overflow-hidden border-b border-amber-100 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 p-6 text-white">
                <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 shadow-inner">
                      <Flame className="h-8 w-8" />
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.24em] text-white/80">Battle Starts In</p>
                      <h2 className="text-3xl font-black tracking-tight">集中していこう</h2>
                    </div>
                  </div>
                  <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-white/70 bg-white/20 text-6xl font-black shadow-lg">
                    {startingRemainingSeconds}
                  </div>
                </div>
              </div>
            )}
            <CardHeader className="border-b bg-amber-50/40">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-600">
                {room.subject || '漢字'} / {room.category || '漢字対戦'}
              </div>
              <CardTitle className="text-xl font-black text-gray-900">
                {(room.unitTitle || '').replace(/^単元\s*/, '')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Room ID</p>
                  <p className="font-mono text-lg font-black text-gray-900">{roomId}</p>
                </div>
                <Button variant="outline" onClick={copyRoomId} className="border-amber-200 bg-white text-amber-700">
                  <Copy className="mr-2 h-4 w-4" />
                  {copied ? 'コピー済み' : 'コピー'}
                </Button>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-700">
                  <Users className="h-4 w-4 text-amber-500" />
                  参加者 {activeParticipants.length}/4
                </div>
                <div className="space-y-2">
                  {participants.map(participant => (
                    <div key={participant.uid} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-3">
                      <div className="min-w-0">
                        <span className="truncate text-sm font-bold text-gray-800">{participant.name}</span>
                        {participant.uid === room.hostUid && (
                          <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                            HOST
                          </span>
                        )}
                      </div>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider ${
                        participant.abandoned
                          ? 'bg-red-50 text-red-600'
                          : participant.ready && participant.questionsReady ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        <CheckCircle2 className="h-3 w-3" />
                        {participant.abandoned ? 'LEFT' : participant.ready ? participant.questionsReady ? 'READY' : 'LOAD' : 'WAIT'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={toggleReady}
                  disabled={room.status !== 'waiting' || isStartingCountdown}
                  className={`flex-1 font-bold ${
                    currentParticipant?.ready
                      ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                      : 'border-amber-200 bg-white text-amber-700 hover:bg-amber-50'
                  }`}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {currentParticipant?.ready ? currentParticipant?.questionsReady ? '準備完了' : '問題読み込み中...' : '準備完了'}
                </Button>
                <Button
                  className="flex-1 bg-amber-500 font-bold text-white hover:bg-amber-600"
                  disabled={!isHost || !allReady || !allQuestionsReady || room.status !== 'waiting' || isStartingCountdown || starting}
                  onClick={startBattle}
                >
                  <Play className="mr-2 h-4 w-4" />
                  {starting || isStartingCountdown ? '開始中...' : isHost ? allQuestionsReady ? '対戦開始' : '問題読み込み待ち' : 'ホスト待ち'}
                </Button>
                {isHost && room.status === 'waiting' && !isStartingCountdown && (
                  <Button variant="outline" onClick={cancelRoom} className="border-red-100 bg-red-50 font-bold text-red-600 hover:bg-red-100">
                    <XCircle className="mr-2 h-4 w-4" />
                    中断
                  </Button>
                )}
              </div>
              {preloadError && (
                <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
                  {preloadError}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
