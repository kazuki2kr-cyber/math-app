'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onDisconnect, onValue, ref, remove, serverTimestamp, update } from 'firebase/database';
import { ArrowLeft, CheckCircle2, Copy, Flame, Play, Swords, Users, XCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getRealtimeDb } from '@/lib/firebase';
import { BATTLE_ACCESS_STORAGE_KEY } from '@/lib/battle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface BattleRoom {
  status?: 'waiting' | 'active' | 'completed' | 'cancelled';
  phase?: 'answering' | 'countdown' | 'completed' | 'starting';
  countdownStartedAtMs?: number | null;
  unitId?: string;
  unitTitle?: string;
  subject?: string;
  category?: string;
  hostUid?: string;
  participants?: Record<string, { uid: string; name: string; connected?: boolean; ready?: boolean }>;
}

export default function BattleRoomPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const roomId = String(params.roomId || '');
  const [hasBattleAccess, setHasBattleAccess] = useState(false);
  const [room, setRoom] = useState<BattleRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const isUnlocked = sessionStorage.getItem(BATTLE_ACCESS_STORAGE_KEY) === 'true';
    setHasBattleAccess(isUnlocked);
    if (!isUnlocked) router.replace('/battle');
  }, [router]);

  useEffect(() => {
    if (!roomId || !hasBattleAccess) return;
    const realtimeDb = getRealtimeDb();
    const roomRef = ref(realtimeDb, `battleRooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const nextRoom = snapshot.exists() ? snapshot.val() : null;
      setRoom(nextRoom);
      setLoading(false);
      if (nextRoom?.status === 'active') {
        router.replace(`/battle/room/${roomId}/play`);
      }
    });

    return () => unsubscribe();
  }, [hasBattleAccess, roomId, router]);

  useEffect(() => {
    if (!roomId || !hasBattleAccess || !user || !room) return;
    const realtimeDb = getRealtimeDb();
    if (room.hostUid === user.uid) {
      const disconnectAction = onDisconnect(ref(realtimeDb, `battleRooms/${roomId}`));
      disconnectAction.remove();
      return () => {
        disconnectAction.cancel();
      };
    }

    if (room.participants?.[user.uid]) {
      const disconnectAction = onDisconnect(ref(realtimeDb, `battleRooms/${roomId}/participants/${user.uid}`));
      disconnectAction.remove();
      return () => {
        disconnectAction.cancel();
      };
    }
  }, [hasBattleAccess, room, roomId, user]);

  const participants = Object.values(room?.participants || {});
  const isHost = !!user && room?.hostUid === user.uid;
  const currentParticipant = user ? room?.participants?.[user.uid] : null;
  const allReady = participants.length >= 2 && participants.every(participant => participant.ready);
  const isStartingCountdown = room?.status === 'waiting' && room?.phase === 'starting';
  const startingRemainingMs = Math.max(0, 3000 - Math.max(0, nowMs - Number(room?.countdownStartedAtMs || nowMs)));
  const startingRemainingSeconds = Math.max(1, Math.ceil(startingRemainingMs / 1000));

  const copyRoomId = async () => {
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const startBattle = async () => {
    if (!isHost || !room || participants.length < 2 || starting) return;
    if (!allReady) return;
    setStarting(true);
    try {
      const realtimeDb = getRealtimeDb();
      await update(ref(realtimeDb, `battleRooms/${roomId}`), {
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
    update(ref(realtimeDb, `battleRooms/${roomId}`), {
      status: 'active',
      currentQuestionIndex: 0,
      phase: 'answering',
      questionStartedAtMs: Date.now(),
      countdownStartedAtMs: null,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }, [isHost, isStartingCountdown, roomId, startingRemainingMs]);

  const toggleReady = async () => {
    if (!user || !room || room.status !== 'waiting' || isStartingCountdown) return;
    const realtimeDb = getRealtimeDb();
    await update(ref(realtimeDb, `battleRooms/${roomId}/participants/${user.uid}`), {
      uid: user.uid,
      name: user.displayName || user.email || currentParticipant?.name || 'Player',
      connected: true,
      ready: !currentParticipant?.ready,
    });
  };

  const cancelRoom = async () => {
    if (!isHost) return;
    const realtimeDb = getRealtimeDb();
    await remove(ref(realtimeDb, `battleRooms/${roomId}`));
  };

  if (!hasBattleAccess) {
    return (
      <div className="min-h-screen bg-[#F8FAEB] p-4 md:p-8">
        <main className="mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-100 border-t-amber-500" />
        </main>
      </div>
    );
  }

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
          <Button variant="ghost" onClick={() => router.push('/battle')} className="text-muted-foreground">
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
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.35),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(255,255,255,0.22),transparent_26%)]" />
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
                {room.subject || 'その他'} / {room.category || 'その他'}
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
                  参加者 {participants.length}/4
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
                        participant.ready ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        <CheckCircle2 className="h-3 w-3" />
                        {participant.ready ? 'READY' : 'WAIT'}
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
                  {currentParticipant?.ready ? '準備完了済み' : '準備完了'}
                </Button>
                <Button
                  className="flex-1 bg-amber-500 font-bold text-white hover:bg-amber-600"
                  disabled={!isHost || !allReady || room.status !== 'waiting' || isStartingCountdown || starting}
                  onClick={startBattle}
                >
                  <Play className="mr-2 h-4 w-4" />
                  {starting || isStartingCountdown ? '開始準備中...' : isHost ? '対戦開始' : 'ホストの開始待ち'}
                </Button>
                {isHost && room.status === 'waiting' && !isStartingCountdown && (
                  <Button variant="outline" onClick={cancelRoom} className="border-red-100 bg-red-50 font-bold text-red-600 hover:bg-red-100">
                    <XCircle className="mr-2 h-4 w-4" />
                    中断
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
