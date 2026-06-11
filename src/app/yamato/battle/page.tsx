'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import {
  equalTo,
  get,
  limitToFirst,
  onDisconnect,
  orderByChild,
  query as realtimeQuery,
  ref,
  serverTimestamp,
  set,
} from 'firebase/database';
import { ArrowLeft, Lock, Medal, Shuffle, Swords, Trophy, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { db, getRealtimeDb } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BATTLE_RANKS,
  BATTLE_ROOM_TTL_MS,
  BATTLE_XP_PER_RANK,
  KANJI_BATTLE_ACCESS_PASSWORD,
  KANJI_BATTLE_ACCESS_STORAGE_KEY,
  getBattleRank,
  getNextBattleRank,
} from '@/lib/battle';
import { getKanjiSeasonBadges, KANJI_SEASONS, KanjiSeasonArchive } from '@/lib/kanjiSeasons';

const KANJI_BATTLE_ROOM_PATH = 'kanjiBattleRooms';

interface BattleUnit {
  id: string;
  title: string;
  category?: string;
  subject?: string;
  baseSubject?: string;
  totalQuestions?: number;
}

interface BattleProfile {
  wins: number;
  xp: number;
}

interface BattleRankingEntry {
  uid: string;
  name?: string;
  icon?: string;
  xp?: number;
  wins?: number;
  totalBattles?: number;
  badges?: any[];
}

interface WaitingRoomCandidate {
  code: string;
  createdAtMs: number;
}

interface RoomParticipantState {
  abandoned?: boolean;
}

function getJoinErrorMessage(err: unknown) {
  return err instanceof Error && err.message === 'room-not-found'
    ? '指定されたルームが見つかりません。'
    : err instanceof Error && err.message === 'room-not-waiting'
      ? 'このルームは現在参加できません。'
      : err instanceof Error && err.message === 'room-full'
        ? 'このルームは満員です。'
        : err instanceof Error && err.message === 'no-waiting-room'
          ? '参加できる待機中のルームがありません。'
          : 'ルームに参加できませんでした。';
}

export default function KanjiBattlePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [hasBattleAccess, setHasBattleAccess] = useState(true);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [battleProfile, setBattleProfile] = useState<BattleProfile>({ wins: 0, xp: 0 });
  const [userData, setUserData] = useState<any>(null);
  const [season2Archive, setSeason2Archive] = useState<KanjiSeasonArchive | null>(null);
  const [battleRanking, setBattleRanking] = useState<BattleRankingEntry[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
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
    setHasBattleAccess(true);
  }, []);

  useEffect(() => {
    if (!hasBattleAccess) {
      setLoading(false);
      return;
    }

    async function fetchBattleUnits() {
      setLoading(true);
      setError(null);
      try {
        const unitsSnap = await getDocs(collection(db, 'units'));
        const battleUnits = unitsSnap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as BattleUnit))
          .filter(unit => unit.subject === 'kanji' || unit.subject === '漢字' || unit.baseSubject === '漢字')
          .sort((a, b) => {
            const subjectCompare = (a.baseSubject || a.subject || '').localeCompare(b.baseSubject || b.subject || '', 'ja');
            if (subjectCompare !== 0) return subjectCompare;
            const categoryCompare = (a.category || '').localeCompare(b.category || '', 'ja', { numeric: true });
            if (categoryCompare !== 0) return categoryCompare;
            return a.title.localeCompare(b.title, 'ja', { numeric: true });
          });
        setUnits(battleUnits);
      } catch (err) {
        console.error('Failed to load kanji battle units:', err);
        setError('漢字の単元を読み込めませんでした。');
      } finally {
        setLoading(false);
      }
    }

    fetchBattleUnits();
  }, [hasBattleAccess]);

  useEffect(() => {
    if (!hasBattleAccess || !user) return;

    async function fetchBattleProfile() {
      try {
        const userSnap = await getDoc(doc(db, 'users', user!.uid));
        const data = userSnap.exists() ? userSnap.data() : {};
        setUserData(data);
        const stats = data.kanjiBattleStats || {};
        const wins = Number(stats.wins || stats.totalWins || data.kanjiBattleWins || 0);
        const xp = Number(stats.xp || data.kanjiBattleXp || wins * 100 || 0);
        setBattleProfile({ wins: Math.max(0, wins), xp: Math.max(0, xp) });
      } catch (err) {
        console.error('Failed to load kanji battle profile:', err);
        setBattleProfile({ wins: 0, xp: 0 });
      }
    }

    fetchBattleProfile();
  }, [hasBattleAccess, user]);

  useEffect(() => {
    if (!hasBattleAccess) return;
    async function fetchSeasonArchive() {
      const season = KANJI_SEASONS.find((item) => item.id === 'season2');
      if (!season) return;
      try {
        const archiveSnap = await getDoc(doc(db, 'leaderboards', season.archiveDocumentId));
        setSeason2Archive(archiveSnap.exists() ? archiveSnap.data() as KanjiSeasonArchive : null);
      } catch (err) {
        console.error('Failed to load kanji battle season archive:', err);
      }
    }
    fetchSeasonArchive();
  }, [hasBattleAccess]);

  const subjects = useMemo(() => {
    return Array.from(new Set(units.map(unit => unit.baseSubject || unit.subject || '漢字'))).sort();
  }, [units]);

  const categories = useMemo(() => {
    return Array.from(new Set(
      units
        .filter(unit => selectedSubject === 'all' || (unit.baseSubject || unit.subject || '漢字') === selectedSubject)
        .map(unit => unit.category || '漢字対戦')
    )).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
  }, [selectedSubject, units]);

  const filteredUnits = units.filter(unit => {
    const unitSubject = unit.baseSubject || unit.subject || '漢字';
    const unitCategory = unit.category || '漢字対戦';
    return (selectedSubject === 'all' || unitSubject === selectedSubject)
      && (selectedCategory === 'all' || unitCategory === selectedCategory);
  });

  const currentRank = getBattleRank(battleProfile.xp);
  const nextRank = getNextBattleRank(battleProfile.xp);
  const currentRankIndex = BATTLE_RANKS.findIndex(rank => rank.title === currentRank.title);
  const nextRankXp = nextRank?.minXp ?? currentRank.minXp + BATTLE_XP_PER_RANK;
  const rankSpanXp = Math.max(1, nextRankXp - currentRank.minXp);
  const xpInRank = Math.max(0, battleProfile.xp - currentRank.minXp);
  const xpToNextRank = nextRank ? Math.max(0, nextRank.minXp - battleProfile.xp) : 0;
  const rankProgressPercent = nextRank ? Math.min(100, Math.max(0, (xpInRank / rankSpanXp) * 100)) : 100;

  const unlockBattleMode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwordInput === KANJI_BATTLE_ACCESS_PASSWORD) {
      sessionStorage.setItem(KANJI_BATTLE_ACCESS_STORAGE_KEY, 'true');
      setHasBattleAccess(true);
      setPasswordError(null);
      return;
    }
    setPasswordError('パスワードが違います。');
  };

  const generateRoomCode = async () => {
    const realtimeDb = getRealtimeDb();
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const roomSnap = await get(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${code}`));
      if (!roomSnap.exists()) return code;
    }
    throw new Error('room-code-collision');
  };

  const createRandomRoom = () => {
    const eligible = units.filter(u => (u.totalQuestions || 0) >= 10);
    if (eligible.length === 0) {
      setError('ランダム範囲で対戦できる範囲がありません。');
      return;
    }
    const unit = eligible[Math.floor(Math.random() * eligible.length)];
    createRoom({ ...unit, title: '???', category: 'ランダム範囲' });
  };

  const createRoom = async (unit: BattleUnit) => {
    if (!user || isCreatingRoomRef.current) return;
    isCreatingRoomRef.current = true;
    setCreatingUnitId(unit.id);
    setError(null);
    let navigated = false;
    try {
      const realtimeDb = getRealtimeDb();
      const nextRoomCode = await generateRoomCode();
      const roomRef = ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${nextRoomCode}`);
      const now = Date.now();
      await Promise.race([
        set(roomRef, {
          status: 'waiting',
          unitId: unit.id,
          unitTitle: unit.title,
          subject: unit.baseSubject || unit.subject || '漢字',
          category: unit.category || '漢字対戦',
          questionCount: 10,
          minPlayers: 2,
          maxPlayers: 4,
          hostUid: user.uid,
          createdAt: serverTimestamp(),
          createdAtMs: now,
          updatedAt: serverTimestamp(),
          expiresAt: now + BATTLE_ROOM_TTL_MS,
          participants: {
            [user.uid]: {
              uid: user.uid,
              name: user.displayName || user.email || 'Player',
              joinedAt: serverTimestamp(),
              connected: true,
              ready: false,
              questionsReady: false,
              playReady: false,
            },
          },
        }),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('realtime-database-timeout')), 10000);
        }),
      ]);
      await onDisconnect(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${nextRoomCode}/participants/${user.uid}`)).update({
        uid: user.uid,
        name: user.displayName || user.email || 'Player',
        connected: false,
        abandoned: true,
        abandonedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      navigated = true;
      router.push(`/yamato/battle/room/${nextRoomCode}`);
    } catch (err) {
      console.error('Failed to create kanji battle room:', err);
      const message = err instanceof Error && err.message === 'realtime-database-timeout'
        ? 'Realtime Database への接続がタイムアウトしました。設定を確認してください。'
        : err instanceof Error && err.message === 'room-code-collision'
          ? 'ルーム番号の生成に失敗しました。もう一度お試しください。'
          : '対戦ルームを作成できませんでした。';
      setError(message);
    } finally {
      if (!navigated) {
        isCreatingRoomRef.current = false;
        setCreatingUnitId(null);
      }
    }
  };

  const joinRoomByCode = async (normalizedCode: string) => {
    if (!user) return;
    const realtimeDb = getRealtimeDb();
    const roomRef = ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${normalizedCode}`);
    const roomSnap = await get(roomRef);
    if (!roomSnap.exists()) throw new Error('room-not-found');

    const room = roomSnap.val();
    const participants = (room?.participants || {}) as Record<string, RoomParticipantState>;
    const activeParticipantCount = Object.values(participants).filter(participant => !participant?.abandoned).length;
    if (room?.status !== 'waiting') throw new Error('room-not-waiting');
    if (!participants[user.uid] && activeParticipantCount >= Number(room?.maxPlayers || 4)) throw new Error('room-full');

    await set(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${normalizedCode}/participants/${user.uid}`), {
      uid: user.uid,
      name: user.displayName || user.email || 'Player',
      joinedAt: serverTimestamp(),
      connected: true,
      abandoned: false,
      ready: false,
      questionsReady: false,
      playReady: false,
    });
    await onDisconnect(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${normalizedCode}/participants/${user.uid}`)).update({
      uid: user.uid,
      name: user.displayName || user.email || 'Player',
      connected: false,
      abandoned: true,
      abandonedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    router.push(`/yamato/battle/room/${normalizedCode}`);
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
      console.error('Failed to join kanji battle room:', err);
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
        ref(realtimeDb, KANJI_BATTLE_ROOM_PATH),
        orderByChild('status'),
        equalTo('waiting'),
        limitToFirst(30)
      ));
      const candidates: WaitingRoomCandidate[] = [];
      waitingRoomsSnap.forEach((roomSnap) => {
        const room = roomSnap.val();
        const participants = (room?.participants || {}) as Record<string, RoomParticipantState>;
        const participantCount = Object.values(participants).filter(participant => !participant?.abandoned).length;
        const maxPlayers = Number(room?.maxPlayers || 4);
        const expiresAt = Number(room?.expiresAt || 0);
        const isFresh = !expiresAt || expiresAt > Date.now();
        const alreadyParticipant = !!participants[user.uid] && !participants[user.uid]?.abandoned;
        if (isFresh && !alreadyParticipant && participantCount < maxPlayers) {
          candidates.push({
            code: String(roomSnap.key),
            createdAtMs: Number(room?.createdAtMs || room?.createdAt || (expiresAt ? expiresAt - BATTLE_ROOM_TTL_MS : 0)),
          });
        }
      });
      if (candidates.length === 0) throw new Error('no-waiting-room');

      const sortedCandidates = [...candidates].sort((a, b) => b.createdAtMs - a.createdAtMs || b.code.localeCompare(a.code));
      let lastErr: unknown;
      for (const candidate of sortedCandidates) {
        try {
          await joinRoomByCode(candidate.code);
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr ?? new Error('no-waiting-room');
    } catch (err) {
      console.error('Failed to join random kanji battle room:', err);
      setError(getJoinErrorMessage(err));
    } finally {
      isJoiningRoomRef.current = false;
      setJoiningRandomRoom(false);
    }
  };

  const loadBattleRanking = async () => {
    setRankingLoading(true);
    try {
      const lbDoc = await getDoc(doc(db, 'leaderboards', 'kanjiBattle'));
      if (lbDoc.exists() && Array.isArray(lbDoc.data().rankings)) {
        setBattleRanking(lbDoc.data().rankings.slice(0, 10));
      } else {
        setBattleRanking([]);
      }
      setShowRanking(true);
    } catch (err) {
      console.error('Failed to load kanji battle ranking:', err);
      setBattleRanking([]);
      setShowRanking(true);
    } finally {
      setRankingLoading(false);
    }
  };

  const myRankInfo = useMemo(() => {
    if (!user || battleRanking.length === 0) return null;
    const index = battleRanking.findIndex(entry => entry.uid === user.uid);
    if (index === -1) return { rank: 11, data: { xp: battleProfile.xp, wins: battleProfile.wins } };
    return { rank: index + 1, data: battleRanking[index] };
  }, [battleProfile, battleRanking, user]);

  const battleRankingPanel = !showRanking ? (
    <Card className="overflow-hidden border border-orange-900/10 border-t-4 border-t-amber-400 bg-white/95 shadow-sm">
      <CardContent className="flex flex-col items-center gap-4 p-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
          <Trophy className="h-8 w-8 text-amber-500" />
        </div>
        <div className="text-center">
          <h2 className="text-base font-black text-gray-900">対戦スコアランキング</h2>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">対戦XPの上位10名を表示します。</p>
        </div>
        <Button
          onClick={loadBattleRanking}
          disabled={rankingLoading}
          className="w-full bg-amber-500 font-bold text-white shadow-sm hover:bg-amber-600"
        >
          {rankingLoading ? (
            <><div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> 読み込み中...</>
          ) : (
            <><Medal className="mr-2 h-4 w-4" /> 対戦ランキングを表示 (Top 10)</>
          )}
        </Button>
      </CardContent>
    </Card>
  ) : (
    <Card className="overflow-hidden border border-orange-900/10 border-t-4 border-t-amber-400 bg-white/95 shadow-lg">
      <CardContent className="flex flex-col p-0">
        {myRankInfo && (
          <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500 text-sm font-black text-white shadow-sm">
                {myRankInfo.rank > 10 ? '圏外' : myRankInfo.rank}
              </div>
              <div>
                <p className="text-xs font-bold tracking-wider text-amber-800">
                  {myRankInfo.rank > 10 ? 'Top 10圏外' : 'あなたの現在の順位'}
                </p>
                <p className="mt-1 text-xl font-black leading-none text-amber-900">
                  {Number(myRankInfo.data.xp || 0).toLocaleString()}
                  <span className="ml-1 text-xs font-bold opacity-70">XP</span>
                </p>
                <p className="mt-1 text-[10px] font-black text-amber-900/60">
                  {getBattleRank(Number(myRankInfo.data.xp || 0)).icon} {getBattleRank(Number(myRankInfo.data.xp || 0)).title}
                </p>
              </div>
            </div>
          </div>
        )}

        {battleRanking.length === 0 ? (
          <div className="p-8 text-center text-sm font-semibold text-muted-foreground">
            まだ対戦スコアがありません。
          </div>
        ) : (
          <div className="divide-y divide-orange-900/5">
            {battleRanking.map((rankUser, index) => {
              const rank = index + 1;
              const isCurrentUser = rankUser.uid === user?.uid;
              const battleXp = Number(rankUser.xp || 0);
              const battleRank = getBattleRank(battleXp);

              return (
                <div
                  key={rankUser.uid}
                  className={`relative flex items-center px-5 py-4 transition-colors ${isCurrentUser ? 'bg-amber-50/60' : 'hover:bg-gray-50'}`}
                >
                  {isCurrentUser && <div className="absolute bottom-0 left-0 top-0 w-1 bg-amber-400" />}
                  <div className="mr-3 w-8 flex-shrink-0 text-center font-black">
                    {rank === 1 ? <Medal className="mx-auto h-6 w-6 text-yellow-500" /> :
                      rank === 2 ? <Medal className="mx-auto h-5 w-5 text-gray-400" /> :
                        rank === 3 ? <Medal className="mx-auto h-5 w-5 text-amber-700" /> :
                          <span className="text-gray-400">{rank}</span>}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-50 text-lg font-black text-amber-800">
                      {battleRank.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-gray-800">
                        {rankUser.name || 'Player'}
                        {getKanjiSeasonBadges(rankUser).map((badge) => (
                          <span key={badge.seasonId} className="relative ml-1 inline-block h-5 w-5 align-middle" title={badge.label}>
                            <Image src={badge.badgeImageUrl} alt={badge.label} fill sizes="20px" className="object-contain" />
                          </span>
                        ))}
                        {isCurrentUser && <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase text-amber-800">You</span>}
                      </p>
                      <p className="font-mono text-[10px] font-semibold text-amber-900/60">
                        {battleRank.title}
                      </p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-lg font-black leading-none text-amber-950">
                      {battleXp.toLocaleString()}
                    </p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-amber-900/40">XP</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (!hasBattleAccess) {
    return (
      <div className="min-h-screen bg-[#F8FAEB] p-4 md:p-8">
        <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center gap-5">
          <div className="rounded-2xl border border-amber-100 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-black text-gray-900">漢字対戦モード（β版）</h1>
                <p className="text-sm font-semibold text-muted-foreground">現在は限定公開中です。</p>
              </div>
            </div>
            <form onSubmit={unlockBattleMode} className="space-y-3">
              <input
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                type="password"
                placeholder="パスワード"
                className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-base font-bold outline-none focus:border-amber-400"
              />
              {passwordError && (
                <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-700">
                  {passwordError}
                </div>
              )}
              <Button type="submit" className="h-12 w-full bg-amber-500 font-bold text-white hover:bg-amber-600">
                入室する
              </Button>
              <Button type="button" variant="ghost" onClick={() => router.push('/yamato')} className="h-10 w-full text-muted-foreground">
                戻る
              </Button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAEB] p-4 md:p-8">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-amber-100 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Swords className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-gray-900">漢字対戦モード</h1>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kanji battle beta</p>
            </div>
          </div>
          <Button variant="ghost" onClick={() => router.push('/yamato')} className="justify-start text-muted-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            漢字モードへ戻る
          </Button>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-4xl font-black text-amber-800 shadow-inner">
                {currentRank.icon}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-widest text-amber-600">Battle Profile</p>
                <h2 className="truncate text-2xl font-black text-gray-900">
                  {user?.displayName || user?.email || 'ゲスト'} <span className="text-sm font-bold text-muted-foreground">さん</span>
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">
                    Rank {currentRankIndex + 1}
                  </span>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-black text-gray-700">
                    {currentRank.title}
                  </span>
                  {getKanjiSeasonBadges(userData).map((badge) => (
                    <span key={badge.seasonId} className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-black text-amber-800">
                      <span className="relative h-6 w-6">
                        <Image src={badge.badgeImageUrl} alt={badge.label} fill sizes="24px" className="object-contain" />
                      </span>
                      Season {badge.seasonNumber} 認証
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[480px]">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-bold text-muted-foreground">通算優勝</p>
                <p className="mt-1 text-2xl font-black text-gray-900">{battleProfile.wins.toLocaleString()}回</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-bold text-muted-foreground">対戦XP</p>
                <p className="mt-1 text-2xl font-black text-gray-900">{battleProfile.xp.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-bold text-muted-foreground">次のランクまで</p>
                <p className="mt-1 text-2xl font-black text-gray-900">
                  {nextRank ? `${xpToNextRank.toLocaleString()} XP` : '到達済み'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs font-black text-gray-500">
              <span>{currentRank.title}</span>
              <span>{nextRank ? nextRank.title : '最高ランク'}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${rankProgressPercent}%` }} />
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div className="min-w-0 space-y-6">
          <div className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                type="button"
                onClick={joinRandomRoom}
                disabled={joiningRoom || joiningRandomRoom || creatingUnitId !== null}
                className="h-14 bg-amber-500 px-4 text-sm font-bold leading-tight text-white shadow-sm hover:bg-amber-600 sm:min-w-44"
              >
                {joiningRandomRoom ? (
                  '検索中...'
                ) : (
                  <span className="flex flex-col items-center">
                    <span>空きのあるルームに</span>
                    <span>おまかせで参加</span>
                  </span>
                )}
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

          {false && (
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
          )}

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
            漢字の単元がありません。
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
                      {unit.baseSubject || unit.subject || '漢字'} / {unit.category || '漢字対戦'}
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
            {/* ランダム単元カード */}
            {units.filter(u => (u.totalQuestions || 0) >= 10).length > 0 && (
              <Card className="flex flex-col overflow-hidden border-dashed border-amber-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-lg">
                <CardHeader className="border-b bg-amber-50/60">
                  <div className="text-[10px] font-black uppercase tracking-widest text-amber-600">
                    漢字対戦 / ランダム
                  </div>
                  <CardTitle className="flex items-center gap-2 text-lg font-black leading-tight text-gray-900">
                    <Shuffle className="h-5 w-5 text-amber-500" />
                    ランダム範囲で対戦
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-5">
                  <div className="flex items-center gap-2 text-sm font-bold text-gray-600">
                    <Users className="h-4 w-4 text-amber-500" />
                    2〜4人 / 10問
                  </div>
                  <div className="mt-3 text-xs font-semibold text-muted-foreground">
                    出題範囲をランダムに選んで対戦を始めます。
                  </div>
                </CardContent>
                <CardFooter className="p-5 pt-0">
                  <Button
                    className="w-full bg-amber-500 font-bold text-white shadow-sm hover:bg-amber-600"
                    disabled={creatingUnitId !== null}
                    onClick={createRandomRoom}
                  >
                    {creatingUnitId !== null ? '作成中...' : 'ランダムでルーム作成'}
                  </Button>
                </CardFooter>
              </Card>
            )}
          </div>
        )}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-6">
            {battleRankingPanel}
            {(season2Archive?.topBattleRankings?.length ?? 0) > 0 && (
              <Card className="overflow-hidden border border-amber-200 bg-white/95 shadow-sm">
                <CardHeader className="border-b border-amber-100 bg-amber-50/70 pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-black text-amber-950">
                    <Trophy className="h-5 w-5 text-amber-600" /> Season 2 対戦XP上位
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-amber-100/80">
                    {season2Archive!.topBattleRankings.slice(0, 10).map((rankUser: BattleRankingEntry, index: number) => (
                      <div key={rankUser.uid || index} className="flex items-center gap-3 px-4 py-3">
                        <div className="w-7 text-center text-sm font-black text-amber-700">{index + 1}</div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-gray-800">{rankUser.name || 'Player'}</p>
                          <p className="text-[10px] font-semibold text-amber-900/60">優勝 {Number(rankUser.wins || 0).toLocaleString()}回</p>
                        </div>
                        <div className="text-right">
                          <p className="text-base font-black leading-none text-amber-950">{Number(rankUser.xp || 0).toLocaleString()}</p>
                          <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-amber-900/40">XP</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
