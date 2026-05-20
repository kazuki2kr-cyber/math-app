'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onDisconnect, onValue, ref, serverTimestamp, set, update } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { ArrowLeft, CheckCircle2, Clock, NotebookPen } from 'lucide-react';
import { MathDisplay } from '@/components/MathDisplay';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { HandwritingCanvasRef } from '@/components/HandwritingCanvas';
import { ScratchPaperOverlay } from '@/components/ScratchPaperOverlay';
import { useAuth } from '@/contexts/AuthContext';
import { functions, getRealtimeDb } from '@/lib/firebase';
import {
  BATTLE_ANSWER_LIMIT_MS,
  BATTLE_NEXT_QUESTION_COUNTDOWN_MS,
  BATTLE_QUESTION_COUNT,
  KANJI_BATTLE_ACCESS_STORAGE_KEY,
} from '@/lib/battle';

const KANJI_BATTLE_ROOM_PATH = 'kanjiBattleRooms';
const QUESTION_CACHE_PREFIX = 'kanji_battle_questions';
const FINALIZE_RETRY_MAX = 5;
const FINALIZE_RETRY_BASE_MS = 2000;
const FINALIZE_RETRY_MAX_DELAY_MS = 30000;

interface AnswerRecord {
  uid: string;
  questionId: string;
  selectedIndex: number | null;
  responseMs: number;
  answeredAtMs: number;
  timedOut?: boolean;
}

interface BattleRoom {
  status?: 'waiting' | 'active' | 'completed' | 'cancelled';
  phase?: 'loading' | 'answering' | 'countdown' | 'completed';
  currentQuestionIndex?: number;
  questionStartedAtMs?: number;
  countdownStartedAtMs?: number;
  unitId?: string;
  unitTitle?: string;
  hostUid?: string;
  participants?: Record<string, { uid: string; name: string; connected?: boolean; abandoned?: boolean; playReady?: boolean }>;
  questionAnswers?: Record<string, Record<string, AnswerRecord>>;
  results?: Record<string, unknown>;
  finalizedAt?: number;
}

interface BattleQuestion {
  id: string;
  question_text: string;
  options: string[];
  image_url?: string | null;
}

function clampResponseMs(value: number) {
  if (!Number.isFinite(value)) return BATTLE_ANSWER_LIMIT_MS;
  return Math.min(BATTLE_ANSWER_LIMIT_MS, Math.max(0, Math.round(value)));
}

export default function KanjiBattlePlayPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const roomId = String(params.roomId || '');
  const [room, setRoom] = useState<BattleRoom | null>(null);
  const [questions, setQuestions] = useState<BattleQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [isScratchPaperOpen, setIsScratchPaperOpen] = useState(false);
  const [hasScratchStrokes, setHasScratchStrokes] = useState(false);
  const scratchPaperRef = useRef<HandwritingCanvasRef>(null);
  const lastQuestionIndexRef = useRef<number | null>(null);
  const redirectedToResultRef = useRef(false);
  const finalizeRequestedRef = useRef(false);
  const finalizeRetryCountRef = useRef(0);
  const finalizeRetryTimerRef = useRef<number | null>(null);
  const answerSubmittingRef = useRef(false);

  useEffect(() => {
    if (sessionStorage.getItem(KANJI_BATTLE_ACCESS_STORAGE_KEY) !== 'true') {
      router.replace('/yamato/battle');
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (finalizeRetryTimerRef.current !== null) window.clearTimeout(finalizeRetryTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!roomId) return;
    const realtimeDb = getRealtimeDb();
    const roomRef = ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const nextRoom = snapshot.exists() ? snapshot.val() : null;
      setRoom(nextRoom);
      if (nextRoom?.status === 'waiting') router.replace(`/yamato/battle/room/${roomId}`);
      if (nextRoom?.status === 'cancelled') router.replace('/yamato/battle');
      if (nextRoom?.status === 'completed' && (nextRoom?.finalizedAt || nextRoom?.results) && !redirectedToResultRef.current) {
        redirectedToResultRef.current = true;
        router.replace(`/yamato/battle/room/${roomId}/result`);
      }
    });
    return () => unsubscribe();
  }, [roomId, router]);

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

  useEffect(() => {
    async function fetchQuestions() {
      if (!room?.unitId) return;
      setLoading(true);
      setError(null);
      try {
        const cachedQuestions = sessionStorage.getItem(`${QUESTION_CACHE_PREFIX}:${roomId}`);
        if (cachedQuestions) {
          const parsedQuestions = JSON.parse(cachedQuestions);
          if (Array.isArray(parsedQuestions) && parsedQuestions.length >= BATTLE_QUESTION_COUNT) {
            setQuestions(parsedQuestions);
            setLoading(false);
            return;
          }
        }
        const getKanjiBattleQuestions = httpsCallable<{ roomId: string }, { questions: BattleQuestion[] }>(functions, 'getKanjiBattleQuestions');
        const response = await getKanjiBattleQuestions({ roomId });
        const nextQuestions = response.data.questions || [];
        if (nextQuestions.length < BATTLE_QUESTION_COUNT) throw new Error('not-enough-questions');
        sessionStorage.setItem(`${QUESTION_CACHE_PREFIX}:${roomId}`, JSON.stringify(nextQuestions));
        setQuestions(nextQuestions);
      } catch (err) {
        console.error('Failed to load kanji battle questions:', err);
        setError('漢字対戦用の問題を読み込めませんでした。');
      } finally {
        setLoading(false);
      }
    }

    fetchQuestions();
  }, [room?.unitId, roomId]);

  const currentQuestionIndex = Math.min(Number(room?.currentQuestionIndex || 0), Math.max(0, questions.length - 1));
  const currentQuestion = questions[currentQuestionIndex];
  const participantIds = useMemo(() => Object.keys(room?.participants || {}), [room?.participants]);
  const activeParticipantIds = useMemo(
    () => participantIds.filter(uid => !room?.participants?.[uid]?.abandoned),
    [participantIds, room?.participants]
  );
  const questionAnswers = room?.questionAnswers?.[String(currentQuestionIndex)] || {};
  const myAnswer = user ? questionAnswers[user.uid] : undefined;
  const coordinatorUid = activeParticipantIds[0] || null;
  const isCoordinator = !!user && user.uid === coordinatorUid;
  const questionStartedAtMs = Number(room?.questionStartedAtMs || nowMs);
  const countdownStartedAtMs = Number(room?.countdownStartedAtMs || nowMs);
  const elapsedMs = room?.phase === 'answering' ? clampResponseMs(nowMs - questionStartedAtMs) : 0;
  const remainingMs = room?.phase === 'answering' ? Math.max(0, BATTLE_ANSWER_LIMIT_MS - elapsedMs) : BATTLE_ANSWER_LIMIT_MS;
  const countdownRemainingMs = Math.max(0, BATTLE_NEXT_QUESTION_COUNTDOWN_MS - Math.max(0, nowMs - countdownStartedAtMs));
  const inBuffer = room?.phase === 'answering' && questionStartedAtMs > nowMs;
  const answeredCount = activeParticipantIds.filter(uid => !!questionAnswers[uid]).length;

  useEffect(() => {
    async function markPlayReady() {
      if (!user || !room || room.status !== 'active' || !questions.length || room.participants?.[user.uid]?.playReady || room.participants?.[user.uid]?.abandoned) return;
      const realtimeDb = getRealtimeDb();
      await update(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}/participants/${user.uid}`), {
        uid: user.uid,
        name: user.displayName || user.email || room.participants?.[user.uid]?.name || 'Player',
        connected: true,
        playReady: true,
      });
    }

    markPlayReady();
  }, [questions.length, room, roomId, user]);

  useEffect(() => {
    if (lastQuestionIndexRef.current === currentQuestionIndex) return;
    lastQuestionIndexRef.current = currentQuestionIndex;
    setSelectedIndex(null);
    setIsScratchPaperOpen(false);
    scratchPaperRef.current?.clear();
    setHasScratchStrokes(false);
  }, [currentQuestionIndex]);

  const writeAnswer = async (selected: number | null, timedOut = false) => {
    if (answerSubmittingRef.current || !user || !currentQuestion || myAnswer || !room || room.participants?.[user.uid]?.abandoned || !['answering', 'countdown'].includes(String(room.phase))) return;
    answerSubmittingRef.current = true;
    setSubmitting(true);
    try {
      const safeResponseMs = clampResponseMs(Date.now() - questionStartedAtMs);
      const realtimeDb = getRealtimeDb();
      await set(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}/questionAnswers/${currentQuestionIndex}/${user.uid}`), {
        uid: user.uid,
        questionId: currentQuestion.id,
        selectedIndex: selected,
        responseMs: safeResponseMs,
        answeredAtMs: Date.now(),
        timedOut,
      });
    } finally {
      answerSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const leaveBattle = async () => {
    if (user && room?.status === 'active' && room.participants?.[user.uid]) {
      const realtimeDb = getRealtimeDb();
      await update(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}/participants/${user.uid}`), {
        uid: user.uid,
        name: user.displayName || user.email || room.participants[user.uid]?.name || 'Player',
        connected: false,
        abandoned: true,
        abandonedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    router.push('/yamato/battle');
  };

  useEffect(() => {
    if (!currentQuestion || !user || myAnswer || room?.phase !== 'answering') return;
    if (remainingMs <= 0) writeAnswer(null, true);
  }, [currentQuestion, myAnswer, remainingMs, room?.phase, user]);

  useEffect(() => {
    if (!currentQuestion || !user || myAnswer || room?.phase !== 'countdown') return;
    writeAnswer(null, true);
  }, [currentQuestion, myAnswer, room?.phase, user]);

  useEffect(() => {
    if (!isCoordinator || !room || !questions.length || room.status !== 'active') return;
    const realtimeDb = getRealtimeDb();
    const allPlayReady = activeParticipantIds.length > 0 && activeParticipantIds.every(uid => !!room.participants?.[uid]?.playReady);
    if (room.phase === 'loading' && allPlayReady) {
      update(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}`), {
        phase: 'answering',
        questionStartedAtMs: Date.now() + 3000,
        updatedAt: serverTimestamp(),
      });
      return;
    }
    if (room.phase === 'loading') return;
    const allAnswered = activeParticipantIds.length > 0 && activeParticipantIds.every(uid => !!questionAnswers[uid]);
    const timeUp = remainingMs <= 0;

    if (room.phase === 'answering' && (allAnswered || timeUp)) {
      update(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}`), {
        phase: 'countdown',
        countdownStartedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    if (room.phase === 'countdown' && countdownRemainingMs <= 0) {
      if (currentQuestionIndex >= questions.length - 1) {
        update(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}`), {
          status: 'completed',
          phase: 'completed',
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        update(ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}`), {
          currentQuestionIndex: currentQuestionIndex + 1,
          phase: 'answering',
          questionStartedAtMs: Date.now() + 1000,
          countdownStartedAtMs: null,
          updatedAt: serverTimestamp(),
        });
      }
    }
  }, [activeParticipantIds, countdownRemainingMs, currentQuestionIndex, isCoordinator, questionAnswers, questions.length, remainingMs, room, roomId]);

  useEffect(() => {
    async function finalizeIfNeeded() {
      if (!user || !room || room.status !== 'completed' || !room.participants?.[user.uid] || room.finalizedAt || room.results || finalizing || finalizeRequestedRef.current) return;
      finalizeRequestedRef.current = true;
      setFinalizing(true);
      setFinalizeError(null);
      let retryScheduled = false;
      try {
        const finalizeKanjiBattleRoom = httpsCallable(functions, 'finalizeKanjiBattleRoom');
        await finalizeKanjiBattleRoom({ roomId });
        finalizeRetryCountRef.current = 0;
      } catch (err) {
        console.error('Failed to finalize kanji battle room:', err);
        const nextRetryCount = finalizeRetryCountRef.current + 1;
        finalizeRetryCountRef.current = nextRetryCount;

        if (nextRetryCount <= FINALIZE_RETRY_MAX) {
          const retryDelayMs = Math.min(FINALIZE_RETRY_MAX_DELAY_MS, FINALIZE_RETRY_BASE_MS * (2 ** (nextRetryCount - 1)));
          retryScheduled = true;
          setFinalizeError(`結果の集計に失敗しました。${Math.ceil(retryDelayMs / 1000)}秒後に自動で再試行します...`);
          if (finalizeRetryTimerRef.current !== null) window.clearTimeout(finalizeRetryTimerRef.current);
          finalizeRetryTimerRef.current = window.setTimeout(() => {
            finalizeRetryTimerRef.current = null;
            finalizeRequestedRef.current = false;
            setFinalizing(false);
          }, retryDelayMs);
          return;
        }

        setFinalizeError('結果の集計に失敗しました。時間をおいて結果画面を読み込み直してください。');
      } finally {
        if (!retryScheduled) setFinalizing(false);
      }
    }

    finalizeIfNeeded();
  }, [finalizing, room, roomId, user]);

  const questionProgressPercent = (currentQuestionIndex / Math.max(1, questions.length)) * 100;
  const timerProgressPercent = room?.phase === 'countdown'
    ? Math.max(0, Math.min(100, (countdownRemainingMs / BATTLE_NEXT_QUESTION_COUNTDOWN_MS) * 100))
    : Math.max(0, Math.min(100, (remainingMs / BATTLE_ANSWER_LIMIT_MS) * 100));

  if (room?.status === 'completed' && !room.finalizedAt && !room.results) {
    return (
      <div className="min-h-screen bg-[#F8FAEB] p-4 md:p-8">
        <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 rounded-2xl border border-amber-100 bg-white p-8 text-center shadow-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-100 border-t-amber-500" />
          <div>
            <h1 className="text-xl font-black text-gray-900">結果を集計しています...</h1>
            <p className="mt-2 text-sm font-bold text-muted-foreground">集計が完了すると結果画面へ移動します。</p>
          </div>
          {finalizeError && (
            <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-700">
              {finalizeError}
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAEB] flex flex-col md:py-10 p-4">
      <main className="max-w-3xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <Button variant="ghost" size="sm" onClick={leaveBattle} className="text-muted-foreground hover:text-destructive transition-colors">
            <ArrowLeft className="w-5 h-5 mr-1.5" strokeWidth={1.5} />
            <span className="font-medium">対戦トップへ</span>
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="計算用紙を開く"
              onClick={() => setIsScratchPaperOpen(true)}
              className="relative h-10 border-primary/20 bg-white/80 px-3 text-primary shadow-sm hover:bg-primary/5"
            >
              <NotebookPen className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">計算用紙</span>
              {hasScratchStrokes && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-[#F8FAEB]" />}
            </Button>
            <div className={`flex items-center font-mono text-lg sm:text-xl px-3 sm:px-4 py-1.5 rounded-full border shadow-inner ${
              room?.phase === 'countdown'
                ? 'border-green-200 bg-green-50 text-green-700'
                : inBuffer
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : remainingMs <= 5000
                    ? 'border-red-200 bg-red-50 text-red-600'
                    : 'border-primary/20 bg-primary/10 text-primary'
            }`}>
              <Clock className="w-5 h-5 mr-2" />
              {room?.phase === 'loading'
                ? '準備中'
                : inBuffer
                  ? `スタート ${Math.ceil((questionStartedAtMs - nowMs) / 1000)}`
                  : room?.phase === 'countdown'
                    ? `次へ ${Math.ceil(countdownRemainingMs / 1000)}`
                    : `残り ${Math.ceil(remainingMs / 1000)}`}
            </div>
          </div>
        </div>

        <div className="w-full bg-black/5 h-2.5 rounded-full overflow-hidden shadow-inner">
          <div className="bg-primary h-full transition-all duration-500 ease-out" style={{ width: `${questionProgressPercent}%` }} />
        </div>

        {error && (
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        {loading || !currentQuestion || room?.phase === 'loading' ? (
          <div className="flex justify-center py-20">
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-amber-100 bg-white p-8 text-center shadow-sm">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-100 border-t-amber-500" />
              <div>
                <h1 className="text-lg font-black text-gray-900">1問目を準備しています</h1>
                <p className="mt-1 text-sm font-bold text-muted-foreground">全員の表示準備ができると30秒カウントが始まります。</p>
              </div>
            </div>
          </div>
        ) : !room ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white/70 p-12 text-center text-sm font-bold text-muted-foreground">
            ルームが見つかりません。
          </div>
        ) : (
          <Card className="shadow-2xl border-0 overflow-hidden bg-white/95 backdrop-blur-sm">
            <div className="h-2 w-full bg-primary/80" />
            <CardHeader className="px-8 pt-8 pb-4">
              <CardDescription className="font-bold text-primary tracking-widest uppercase text-sm mb-2">
                Question {currentQuestionIndex + 1} <span className="opacity-50 mx-1">/</span> {questions.length}
                <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">対戦</span>
              </CardDescription>
              <p className="mb-4 text-sm font-bold text-muted-foreground">
                回答済み {answeredCount}/{activeParticipantIds.length}
                {myAnswer && <span className="ml-3 text-green-700">あなたは送信済み</span>}
              </p>
              <div className="mb-4 h-3 overflow-hidden rounded-full bg-black/5 shadow-inner">
                <div
                  className={`h-full rounded-full transition-all ${room.phase === 'countdown' ? 'bg-green-500' : remainingMs <= 5000 ? 'bg-red-500' : 'bg-amber-500'}`}
                  style={{ width: `${timerProgressPercent}%` }}
                />
              </div>
              <CardTitle className="text-2xl leading-relaxed text-gray-900 font-medium">
                <span dangerouslySetInnerHTML={{ __html: currentQuestion.question_text }} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 px-8 pb-8">
              {currentQuestion.image_url && (
                <div className="mb-6 bg-gray-50 p-6 rounded-xl flex justify-center border shadow-inner">
                  <img src={currentQuestion.image_url} alt="問題画像" className="max-h-72 object-contain rounded-md shadow-sm mix-blend-multiply" />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {currentQuestion.options.map((option, index) => {
                  const isSelected = selectedIndex === index;
                  return (
                    <button
                      key={`${currentQuestion.id}-${index}`}
                      type="button"
                      onClick={() => setSelectedIndex(index)}
                      disabled={!!myAnswer || room.phase !== 'answering' || inBuffer}
                      className={`w-full text-left p-5 rounded-xl border-2 transition-all duration-200 ${
                        isSelected
                          ? 'border-primary bg-primary/5 shadow-md scale-[1.02] ring-2 ring-primary/20'
                          : 'border-gray-200 bg-white hover:border-primary/50 hover:bg-gray-50 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-start">
                        <span className={`flex-shrink-0 inline-block w-8 h-8 text-center leading-8 rounded-full text-sm font-bold mr-4 transition-colors ${
                          isSelected ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {index + 1}
                        </span>
                        <div className="pt-1 overflow-visible">
                          <MathDisplay math={option} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>

            <CardFooter className="bg-gray-50/80 border-t p-6 flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center">
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                {myAnswer && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                {myAnswer
                  ? myAnswer.timedOut
                    ? '時間切れです。次の問題へ自動で進みます。'
                    : '送信済みです。次の問題へ自動で進みます。'
                  : '選択後、「回答を送信」で確定します。次の問題へは自動で進みます。'}
              </div>
              <Button
                onClick={() => writeAnswer(selectedIndex, false)}
                disabled={selectedIndex === null || !!myAnswer || room.phase !== 'answering' || inBuffer || submitting}
                size="lg"
                className="h-14 px-10 text-lg font-bold shadow-lg transition-all hover:-translate-y-0.5"
              >
                {myAnswer ? '送信済み' : '回答を送信'}
              </Button>
            </CardFooter>
          </Card>
        )}
      </main>
      {currentQuestion && (
        <ScratchPaperOverlay
          ref={scratchPaperRef}
          open={isScratchPaperOpen}
          questionText={currentQuestion.question_text.replace(/<[^>]*>/g, '')}
          questionNumber={currentQuestionIndex + 1}
          totalQuestions={questions.length}
          onClose={() => setIsScratchPaperOpen(false)}
          onChange={setHasScratchStrokes}
        />
      )}
    </div>
  );
}
