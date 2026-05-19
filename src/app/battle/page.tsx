'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, getDocs, query as firestoreQuery, where } from 'firebase/firestore';
import { equalTo, get, limitToFirst, orderByChild, query as realtimeQuery, ref, serverTimestamp, set } from 'firebase/database';
import { ArrowLeft, Swords, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { db, getRealtimeDb } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

interface BattleUnit {
  id: string;
  title: string;
  category?: string;
  subject?: string;
  baseSubject?: string;
  totalQuestions?: number;
}

export default function BattlePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [units, setUnits] = useState<BattleUnit[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [creatingUnitId, setCreatingUnitId] = useState<string | null>(null);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [joiningRandomRoom, setJoiningRandomRoom] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isCreatingRoomRef = useRef(false);
  const isJoiningRoomRef = useRef(false);

  useEffect(() => {
    async function fetchBattleUnits() {
      setLoading(true);
      setError(null);
      try {
        const unitsSnap = await getDocs(firestoreQuery(collection(db, 'units'), where('mode', '==', 'battle')));
        const battleUnits = unitsSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as BattleUnit))
          .sort((a, b) => {
            const subjectCompare = (a.baseSubject || a.subject || '').localeCompare(b.baseSubject || b.subject || '', 'ja');
            if (subjectCompare !== 0) return subjectCompare;
            const categoryCompare = (a.category || '').localeCompare(b.category || '', 'ja', { numeric: true });
            if (categoryCompare !== 0) return categoryCompare;
            return a.title.localeCompare(b.title, 'ja', { numeric: true });
          });
        setUnits(battleUnits);
      } catch (err) {
        console.error('Failed to load battle units:', err);
        setError('対戦用の単元を読み込めませんでした。');
      } finally {
        setLoading(false);
      }
    }

    fetchBattleUnits();
  }, []);

  const subjects = useMemo(() => {
    return Array.from(new Set(units.map(unit => unit.baseSubject || unit.subject || 'その他'))).sort();
  }, [units]);

  const categories = useMemo(() => {
    return Array.from(new Set(
      units
        .filter(unit => selectedSubject === 'all' || (unit.baseSubject || unit.subject || 'その他') === selectedSubject)
        .map(unit => unit.category || 'その他')
    )).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
  }, [selectedSubject, units]);

  const filteredUnits = units.filter(unit => {
    const unitSubject = unit.baseSubject || unit.subject || 'その他';
    const unitCategory = unit.category || 'その他';
    return (selectedSubject === 'all' || unitSubject === selectedSubject)
      && (selectedCategory === 'all' || unitCategory === selectedCategory);
  });

  const generateRoomCode = async () => {
    const realtimeDb = getRealtimeDb();
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const roomSnap = await get(ref(realtimeDb, `battleRooms/${code}`));
      if (!roomSnap.exists()) return code;
    }
    throw new Error('room-code-collision');
  };

  const createRoom = async (unit: BattleUnit) => {
    if (!user || isCreatingRoomRef.current) return;
    isCreatingRoomRef.current = true;
    setCreatingUnitId(unit.id);
    setError(null);
    try {
      const realtimeDb = getRealtimeDb();
      const roomCode = await generateRoomCode();
      const roomRef = ref(realtimeDb, `battleRooms/${roomCode}`);
      await Promise.race([
        set(roomRef, {
          status: 'waiting',
          unitId: unit.id,
          unitTitle: unit.title,
          subject: unit.baseSubject || unit.subject || 'その他',
          category: unit.category || 'その他',
          questionCount: 10,
          minPlayers: 2,
          maxPlayers: 4,
          hostUid: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          participants: {
            [user.uid]: {
              uid: user.uid,
              name: user.displayName || user.email || 'Player',
              joinedAt: serverTimestamp(),
              connected: true,
            },
          },
        }),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('realtime-database-timeout')), 10000);
        }),
      ]);
      router.push(`/battle/room/${roomCode}`);
    } catch (err) {
      console.error('Failed to create battle room:', err);
      const message = err instanceof Error && err.message === 'missing-realtime-database-url'
        ? 'Realtime Database のURLが未設定です。NEXT_PUBLIC_FIREBASE_DATABASE_URL を .env.local に設定してください。'
        : err instanceof Error && err.message === 'realtime-database-timeout'
          ? 'Realtime Database への接続がタイムアウトしました。Database URL と Firebase 側のインスタンス設定を確認してください。'
          : err instanceof Error && err.message === 'room-code-collision'
            ? 'ルーム番号の生成に失敗しました。もう一度お試しください。'
            : '対戦ルームを作成できませんでした。';
      setError(message);
    } finally {
      isCreatingRoomRef.current = false;
      setCreatingUnitId(null);
    }
  };

  const joinRoomByCode = async (normalizedCode: string) => {
    if (!user) return;
    const realtimeDb = getRealtimeDb();
    const roomRef = ref(realtimeDb, `battleRooms/${normalizedCode}`);
    const roomSnap = await get(roomRef);
    if (!roomSnap.exists()) {
      throw new Error('room-not-found');
    }

    const room = roomSnap.val();
    const participants = room?.participants || {};
    const participantCount = Object.keys(participants).length;
    if (room?.status !== 'waiting') {
      throw new Error('room-not-waiting');
    }
    if (!participants[user.uid] && participantCount >= Number(room?.maxPlayers || 4)) {
      throw new Error('room-full');
    }

    await set(ref(realtimeDb, `battleRooms/${normalizedCode}/participants/${user.uid}`), {
      uid: user.uid,
      name: user.displayName || user.email || 'Player',
      joinedAt: serverTimestamp(),
      connected: true,
    });
    router.push(`/battle/room/${normalizedCode}`);
  };

  const getJoinErrorMessage = (err: unknown) => {
    return err instanceof Error && err.message === 'missing-realtime-database-url'
      ? 'Realtime Database のURLが未設定です。NEXT_PUBLIC_FIREBASE_DATABASE_URL を .env.local に設定してください。'
      : err instanceof Error && err.message === 'room-not-found'
        ? '指定されたルームが見つかりません。'
        : err instanceof Error && err.message === 'room-not-waiting'
          ? 'このルームは現在参加できません。'
          : err instanceof Error && err.message === 'room-full'
            ? 'このルームは満員です。'
            : err instanceof Error && err.message === 'no-waiting-room'
              ? '参加できる待機中のルームがありません。'
              : 'ルームに参加できませんでした。';
  };

  const joinRoom = async () => {
    if (!user || isJoiningRoomRef.current) return;
    const normalizedCode = roomCode.replace(/\D/g, '').slice(0, 6);
    if (normalizedCode.length !== 6) {
      setError('6桁のルーム番号を入力してください。');
      return;
    }

    isJoiningRoomRef.current = true;
    setJoiningRoom(true);
    setError(null);
    try {
      await joinRoomByCode(normalizedCode);
    } catch (err) {
      console.error('Failed to join battle room:', err);
      setError(getJoinErrorMessage(err));
    } finally {
      isJoiningRoomRef.current = false;
      setJoiningRoom(false);
    }
  };

  const joinRandomRoom = async () => {
    if (!user || isJoiningRoomRef.current) return;
    isJoiningRoomRef.current = true;
    setJoiningRandomRoom(true);
    setError(null);
    try {
      const realtimeDb = getRealtimeDb();
      const waitingRoomsSnap = await get(realtimeQuery(
        ref(realtimeDb, 'battleRooms'),
        orderByChild('status'),
        equalTo('waiting'),
        limitToFirst(30)
      ));
      const candidates: string[] = [];
      waitingRoomsSnap.forEach((roomSnap) => {
        const room = roomSnap.val();
        const participants = room?.participants || {};
        const participantCount = Object.keys(participants).length;
        const maxPlayers = Number(room?.maxPlayers || 4);
        if (participantCount < maxPlayers || participants[user.uid]) {
          candidates.push(String(roomSnap.key));
        }
      });
      if (candidates.length === 0) {
        throw new Error('no-waiting-room');
      }
      const selectedCode = candidates[Math.floor(Math.random() * candidates.length)];
      await joinRoomByCode(selectedCode);
    } catch (err) {
      console.error('Failed to join random battle room:', err);
      setError(getJoinErrorMessage(err));
    } finally {
      isJoiningRoomRef.current = false;
      setJoiningRandomRoom(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAEB] p-4 md:p-8">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-amber-100 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Swords className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-gray-900">対戦モード</h1>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Battle units only</p>
            </div>
          </div>
          <Button variant="ghost" onClick={() => router.push('/')} className="justify-start text-muted-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            戻る
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                type="button"
                onClick={joinRandomRoom}
                disabled={joiningRoom || joiningRandomRoom || creatingUnitId !== null}
                className="h-14 bg-amber-500 px-6 text-base font-bold text-white shadow-sm hover:bg-amber-600 sm:min-w-40"
              >
                {joiningRandomRoom ? '検索中...' : 'ランダム参加'}
              </Button>
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                <input
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="ルーム番号"
                  className="h-14 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm font-bold tracking-widest outline-none focus:border-amber-400 sm:min-w-40"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={joinRoom}
                  disabled={joiningRoom || joiningRandomRoom || creatingUnitId !== null || roomCode.length !== 6}
                  className="h-14 border-amber-200 bg-white px-5 font-bold text-amber-700 hover:bg-amber-50"
                >
                  {joiningRoom ? '参加中...' : 'コードで参加'}
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row">
              <select
                value={selectedSubject}
                onChange={(event) => {
                  setSelectedSubject(event.target.value);
                  setSelectedCategory('all');
                }}
                className="h-14 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm font-bold outline-none focus:border-amber-400"
              >
                <option value="all">全教科</option>
                {subjects.map(subject => (
                  <option key={subject} value={subject}>{subject}</option>
                ))}
              </select>
              <select
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
                className="h-14 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm font-bold outline-none focus:border-amber-400"
              >
                <option value="all">全分野</option>
                {categories.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-100 border-t-amber-500" />
          </div>
        ) : filteredUnits.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white/70 p-12 text-center text-sm font-bold text-muted-foreground">
            対戦用の単元がありません。
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredUnits.map(unit => {
              const totalQuestions = unit.totalQuestions || 0;
              const canCreateRoom = totalQuestions >= 10;
              return (
                <Card key={unit.id} className="flex flex-col overflow-hidden border-transparent bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-lg">
                  <CardHeader className="border-b bg-amber-50/40">
                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-600">
                      {unit.baseSubject || unit.subject || 'その他'} / {unit.category || 'その他'}
                    </div>
                    <CardTitle className="text-lg font-black leading-tight text-gray-900">
                      {unit.title.replace(/^単元\s*/, '')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 p-5">
                    <div className="flex items-center gap-2 text-sm font-bold text-gray-600">
                      <Users className="h-4 w-4 text-amber-500" />
                      2〜4人 / 10問
                    </div>
                    <div className="mt-3 text-xs font-semibold text-muted-foreground">
                      登録問題数: {totalQuestions}問
                    </div>
                  </CardContent>
                  <CardFooter className="p-5 pt-0">
                    <Button
                      className="w-full bg-amber-500 font-bold text-white shadow-sm hover:bg-amber-600"
                      disabled={!canCreateRoom || creatingUnitId !== null}
                      onClick={() => createRoom(unit)}
                    >
                      {creatingUnitId === unit.id ? '作成中...' : canCreateRoom ? 'ルーム作成' : '10問以上必要'}
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
