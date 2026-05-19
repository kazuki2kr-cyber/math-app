'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onDisconnect, onValue, ref, remove } from 'firebase/database';
import { ArrowLeft, Copy, Swords, Users, XCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getRealtimeDb } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const BATTLE_ACCESS_STORAGE_KEY = 'battle_mode_access_granted';

interface BattleRoom {
  status?: 'waiting' | 'active' | 'completed' | 'cancelled';
  unitTitle?: string;
  subject?: string;
  category?: string;
  hostUid?: string;
  participants?: Record<string, { uid: string; name: string; connected?: boolean }>;
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

  useEffect(() => {
    const isUnlocked = sessionStorage.getItem(BATTLE_ACCESS_STORAGE_KEY) === 'true';
    setHasBattleAccess(isUnlocked);
    if (!isUnlocked) {
      router.replace('/battle');
    }
  }, [router]);

  useEffect(() => {
    if (!roomId || !hasBattleAccess) return;
    const realtimeDb = getRealtimeDb();
    const roomRef = ref(realtimeDb, `battleRooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      setRoom(snapshot.exists() ? snapshot.val() : null);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [hasBattleAccess, roomId]);

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

  const copyRoomId = async () => {
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
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
                      <span className="text-sm font-bold text-gray-800">{participant.name}</span>
                      <span className="rounded-full bg-green-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-green-700">
                        online
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {room.status === 'cancelled' && (
                <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
                  対戦が中断されました。
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button className="flex-1 bg-amber-500 font-bold text-white hover:bg-amber-600" disabled={participants.length < 2 || room.status !== 'waiting'}>
                  開始
                </Button>
                {isHost && room.status === 'waiting' && (
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
