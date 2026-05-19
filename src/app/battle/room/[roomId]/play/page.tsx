'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore';
import { onDisconnect, onValue, ref, serverTimestamp, set, update } from 'firebase/database';
import { ArrowLeft, CheckCircle2, Clock, NotebookPen, Swords, XCircle } from 'lucide-react';
import { MathDisplay } from '@/components/MathDisplay';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { HandwritingCanvasRef } from '@/components/HandwritingCanvas';
import { ScratchPaperOverlay } from '@/components/ScratchPaperOverlay';
import { useAuth } from '@/contexts/AuthContext';
import { db, getRealtimeDb } from '@/lib/firebase';
import { parseOptions } from '@/lib/utils';
import {
  BATTLE_ACCESS_STORAGE_KEY,
  BATTLE_ANSWER_LIMIT_MS,
  BATTLE_NEXT_QUESTION_COUNTDOWN_MS,
  BATTLE_QUESTION_COUNT,
  calculateBattleQuestionScore,
  calculateBattleSpeedBonus,
} from '@/lib/battle';

interface BattleRoom {
  status?: 'waiting' | 'active' | 'completed' | 'cancelled';
  phase?: 'answering' | 'countdown' | 'completed';
  currentQuestionIndex?: number;
  questionStartedAtMs?: number;
  countdownStartedAtMs?: number;
  unitId?: string;
  unitTitle?: string;
  hostUid?: string;
  participants?: Record<string, { uid: string; name: string }>;
  questionAnswers?: Record<string, Record<string, AnswerRecord>>;
}

interface RawQuestion {
  id: string;
  question_text: string;
  options: string[] | string;
  answer_index: number;
  explanation?: string;
  image_url?: string | null;
}

interface BattleQuestion {
  id: string;
  question_text: string;
  options: string[];
  answer_index: number;
  explanation?: string;
  image_url?: string | null;
}

interface AnswerRecord {
  uid: string;
  questionId: string;
  selectedIndex: number | null;
  correct: boolean;
  responseMs: number;
  speedBonus: number;
  score: number;
  answeredAtMs: number;
  timedOut?: boolean;
}

function clampResponseMs(value: number) {
  if (!Number.isFinite(value)) return BATTLE_ANSWER_LIMIT_MS;
  return Math.min(BATTLE_ANSWER_LIMIT_MS, Math.max(0, Math.round(value)));
}

export default function BattlePlayPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const roomId = String(params.roomId || '');
  const [hasBattleAccess, setHasBattleAccess] = useState(false);
  const [room, setRoom] = useState<BattleRoom | null>(null);
  const [questions, setQuestions] = useState<BattleQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [isScratchPaperOpen, setIsScratchPaperOpen] = useState(false);
  const [hasScratchStrokes, setHasScratchStrokes] = useState(false);
  const scratchPaperRef = useRef<HandwritingCanvasRef>(null);
  const lastQuestionIndexRef = useRef<number | null>(null);
  const submittedResultRef = useRef(false);

  useEffect(() => {
    const isUnlocked = sessionStorage.getItem(BATTLE_ACCESS_STORAGE_KEY) === 'true';
    setHasBattleAccess(isUnlocked);
    if (!isUnlocked) router.replace('/battle');
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!roomId || !hasBattleAccess) return;
    const realtimeDb = getRealtimeDb();
    const roomRef = ref(realtimeDb, `battleRooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const nextRoom = snapshot.exists() ? snapshot.val() : null;
      setRoom(nextRoom);
      if (nextRoom?.status === 'waiting') router.replace(`/battle/room/${roomId}`);
      if (nextRoom?.status === 'completed') router.replace(`/battle/room/${roomId}/result`);
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

  useEffect(() => {
    async function fetchQuestions() {
      if (!room?.unitId) return;
      setLoading(true);
      setError(null);
      try {
        const unitSnap = await getDoc(doc(db, 'units', room.unitId));
        if (!unitSnap.exists()) throw new Error('unit-not-found');
        const rawUnit = unitSnap.data();
        let fetchedQuestions: RawQuestion[] = (rawUnit.questions as RawQuestion[]) || [];
        if (!fetchedQuestions.length) {
          const qSnap = await getDocs(query(collection(db, 'units', room.unitId, 'questions'), orderBy('order', 'asc')));
          fetchedQuestions = qSnap.docs.map(d => ({ id: d.id, ...d.data() } as RawQuestion));
        }
        const nextQuestions = fetchedQuestions.slice(0, BATTLE_QUESTION_COUNT).map((q) => ({
          id: String(q.id),
          question_text: q.question_text,
          options: parseOptions(q.options),
          answer_index: Number(q.answer_index),
          explanation: q.explanation || '',
          image_url: q.image_url || null,
        }));
        if (nextQuestions.length < BATTLE_QUESTION_COUNT) throw new Error('not-enough-questions');
        setQuestions(nextQuestions);
      } catch (err) {
        console.error('Failed to load battle questions:', err);
        setError('対戦用の問題を読み込めませんでした。');
      } finally {
        setLoading(false);
      }
    }

    fetchQuestions();
  }, [room?.unitId]);

  const currentQuestionIndex = Math.min(Number(room?.currentQuestionIndex || 0), Math.max(0, questions.length - 1));
  const currentQuestion = questions[currentQuestionIndex];
  const participantIds = useMemo(() => Object.keys(room?.participants || {}), [room?.participants]);
  const questionAnswers = room?.questionAnswers?.[String(currentQuestionIndex)] || {};
  const myAnswer = user ? questionAnswers[user.uid] : undefined;
  const isHost = !!user && room?.hostUid === user.uid;
  const questionStartedAtMs = Number(room?.questionStartedAtMs || nowMs);
  const countdownStartedAtMs = Number(room?.countdownStartedAtMs || nowMs);
  const elapsedMs = clampResponseMs(nowMs - questionStartedAtMs);
  const remainingMs = Math.max(0, BATTLE_ANSWER_LIMIT_MS - elapsedMs);
  const countdownRemainingMs = Math.max(0, BATTLE_NEXT_QUESTION_COUNTDOWN_MS - Math.max(0, nowMs - countdownStartedAtMs));
  const totalScore = useMemo(() => {
    if (!user || !room?.questionAnswers) return 0;
    return Object.values(room.questionAnswers).reduce((sum, answersByUser) => sum + Number(answersByUser?.[user.uid]?.score || 0), 0);
  }, [room?.questionAnswers, user]);

  useEffect(() => {
    if (lastQuestionIndexRef.current === currentQuestionIndex) return;
    lastQuestionIndexRef.current = currentQuestionIndex;
    setSelectedIndex(null);
    setIsScratchPaperOpen(false);
    scratchPaperRef.current?.clear();
    setHasScratchStrokes(false);
  }, [currentQuestionIndex]);

  const writeAnswer = async (selected: number | null, timedOut = false) => {
    if (!user || !currentQuestion || myAnswer || !room || !['answering', 'countdown'].includes(String(room.phase))) return;
    const safeResponseMs = clampResponseMs(Date.now() - questionStartedAtMs);
    const correct = selected !== null && selected === currentQuestion.answer_index;
    const speedBonus = correct ? calculateBattleSpeedBonus(safeResponseMs) : 0;
    const score = calculateBattleQuestionScore(correct, safeResponseMs);
    const realtimeDb = getRealtimeDb();
    await set(ref(realtimeDb, `battleRooms/${roomId}/questionAnswers/${currentQuestionIndex}/${user.uid}`), {
      uid: user.uid,
      questionId: currentQuestion.id,
      selectedIndex: selected,
      correct,
      responseMs: safeResponseMs,
      speedBonus,
      score,
      answeredAtMs: Date.now(),
      timedOut,
    });
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
    if (!isHost || !room || !questions.length || room.status !== 'active') return;
    const realtimeDb = getRealtimeDb();
    const allAnswered = participantIds.length > 0 && participantIds.every(uid => !!questionAnswers[uid]);
    const timeUp = remainingMs <= 0;

    if (room.phase === 'answering' && (allAnswered || timeUp)) {
      update(ref(realtimeDb, `battleRooms/${roomId}`), {
        phase: 'countdown',
        countdownStartedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    if (room.phase === 'countdown' && countdownRemainingMs <= 0) {
      if (currentQuestionIndex >= questions.length - 1) {
        update(ref(realtimeDb, `battleRooms/${roomId}`), {
          status: 'completed',
          phase: 'completed',
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        update(ref(realtimeDb, `battleRooms/${roomId}`), {
          currentQuestionIndex: currentQuestionIndex + 1,
          phase: 'answering',
          questionStartedAtMs: Date.now(),
          countdownStartedAtMs: null,
          updatedAt: serverTimestamp(),
        });
      }
    }
  }, [countdownRemainingMs, currentQuestionIndex, isHost, participantIds, questionAnswers, questions.length, remainingMs, room, roomId]);

  useEffect(() => {
    async function submitResultIfNeeded() {
      if (!user || !room || !questions.length || room.status !== 'completed' || submittedResultRef.current) return;
      submittedResultRef.current = true;
      setSubmitting(true);
      try {
        const myAnswers = Object.values(room.questionAnswers || {})
          .map(answersByUser => answersByUser?.[user.uid])
          .filter(Boolean) as AnswerRecord[];
        const totalTimeMs = myAnswers.reduce((sum, answer) => sum + clampResponseMs(answer.responseMs), 0);
        const correctCount = myAnswers.filter(answer => answer.correct).length;
        const finalScore = myAnswers.reduce((sum, answer) => sum + Number(answer.score || 0), 0);
        const realtimeDb = getRealtimeDb();
        await set(ref(realtimeDb, `battleRooms/${roomId}/results/${user.uid}`), {
          uid: user.uid,
          name: user.displayName || user.email || 'Player',
          totalScore: finalScore,
          correctCount,
          totalQuestions: questions.length,
          totalTimeMs,
          finishedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('Failed to submit battle result:', err);
        submittedResultRef.current = false;
        setError('結果を送信できませんでした。もう一度お試しください。');
      } finally {
        setSubmitting(false);
        router.replace(`/battle/room/${roomId}/result`);
      }
    }

    submitResultIfNeeded();
  }, [questions.length, room, roomId, router, user]);

  if (!hasBattleAccess) {
    return (
      <div className="min-h-screen bg-[#F8FAEB] p-4 md:p-8">
        <main className="mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-100 border-t-amber-500" />
        </main>
      </div>
    );
  }

  const questionProgressPercent = (currentQuestionIndex / Math.max(1, questions.length)) * 100;
  const timerProgressPercent = room?.phase === 'countdown'
    ? Math.max(0, Math.min(100, (countdownRemainingMs / BATTLE_NEXT_QUESTION_COUNTDOWN_MS) * 100))
    : Math.max(0, Math.min(100, (remainingMs / BATTLE_ANSWER_LIMIT_MS) * 100));

  return (
    <div className="min-h-screen bg-[#F8FAEB] flex flex-col md:py-10 p-4">
      <main className="max-w-3xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/battle/room/${roomId}`)}
            className="text-muted-foreground hover:text-destructive transition-colors"
          >
            <ArrowLeft className="w-5 h-5 mr-1.5" strokeWidth={1.5} />
            <span className="font-medium">ルームへ</span>
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
              {hasScratchStrokes && (
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-[#F8FAEB]" />
              )}
            </Button>
            <div className={`flex items-center font-mono text-lg sm:text-xl px-3 sm:px-4 py-1.5 rounded-full border shadow-inner ${
              room?.phase === 'countdown'
                ? 'border-green-200 bg-green-50 text-green-700'
                : remainingMs <= 5000
                  ? 'border-red-200 bg-red-50 text-red-600'
                  : 'border-primary/20 bg-primary/10 text-primary'
            }`}>
              <Clock className="w-5 h-5 mr-2" />
              {room?.phase === 'countdown'
                ? `次へ ${Math.ceil(countdownRemainingMs / 1000)}`
                : `残り ${Math.ceil(remainingMs / 1000)}`}
            </div>
          </div>
        </div>

        <div className="w-full bg-black/5 h-2.5 rounded-full overflow-hidden shadow-inner">
          <div
            className="bg-primary h-full transition-all duration-500 ease-out"
            style={{ width: `${questionProgressPercent}%` }}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        {loading || !currentQuestion ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-100 border-t-amber-500" />
          </div>
        ) : !room ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white/70 p-12 text-center text-sm font-bold text-muted-foreground">
            ルームが見つかりません。
          </div>
        ) : (
          <Card className="shadow-2xl border-0 overflow-hidden bg-white/95 backdrop-blur-sm">
            <div className="h-2 w-full bg-primary/80"></div>
            <CardHeader className="px-8 pt-8 pb-4">
              <CardDescription className="font-bold text-primary tracking-widest uppercase text-sm mb-2">
                Question {currentQuestionIndex + 1} <span className="opacity-50 mx-1">/</span> {questions.length}
                <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">対戦</span>
              </CardDescription>
              <p className="mb-4 text-sm font-bold text-muted-foreground">
                現在の得点: {totalScore}点 / 回答済み {Object.keys(questionAnswers).length}/{participantIds.length}
              </p>
              <div className="mb-4 h-3 overflow-hidden rounded-full bg-black/5 shadow-inner">
                <div
                  className={`h-full rounded-full transition-all ${
                    room.phase === 'countdown' ? 'bg-green-500' : remainingMs <= 5000 ? 'bg-red-500' : 'bg-amber-500'
                  }`}
                  style={{ width: `${timerProgressPercent}%` }}
                />
              </div>
              <CardTitle className="text-2xl leading-relaxed text-gray-900 font-medium">
                <MathDisplay math={currentQuestion.question_text} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 px-8 pb-8">
              {currentQuestion.image_url && (
                <div className="mb-6 bg-gray-50 p-6 rounded-xl flex justify-center border shadow-inner">
                  <img src={currentQuestion.image_url} alt="Problem visual" className="max-h-72 object-contain rounded-md shadow-sm mix-blend-multiply" />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {currentQuestion.options.map((option, index) => {
                  const isSelected = selectedIndex === index;
                  const isCorrect = index === currentQuestion.answer_index;
                  const showAnswer = room.phase === 'countdown' || !!myAnswer;
                  return (
                    <button
                      key={`${currentQuestion.id}-${index}`}
                      type="button"
                      onClick={() => setSelectedIndex(index)}
                      disabled={!!myAnswer || room.phase !== 'answering'}
                      className={`w-full text-left p-5 rounded-xl border-2 transition-all duration-200 ${
                        showAnswer && isCorrect
                          ? 'border-green-400 bg-green-50 text-green-900 shadow-md'
                          : showAnswer && isSelected && !isCorrect
                            ? 'border-red-300 bg-red-50 text-red-800 shadow-md'
                            : isSelected
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
                {myAnswer?.correct ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : myAnswer ? (
                  <XCircle className="h-4 w-4 text-red-500" />
                ) : null}
                {myAnswer
                  ? myAnswer.correct
                    ? `+${myAnswer.score}点（速度ボーナス +${myAnswer.speedBonus}）`
                    : myAnswer.timedOut
                      ? '時間切れ: 0点'
                      : '不正解: 0点'
                  : '選択後、「回答を送信」で確定します。次の問題へは自動で進みます'}
              </div>
              <Button
                onClick={() => writeAnswer(selectedIndex, false)}
                disabled={selectedIndex === null || !!myAnswer || room.phase !== 'answering' || submitting}
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
          questionText={currentQuestion.question_text}
          questionNumber={currentQuestionIndex + 1}
          totalQuestions={questions.length}
          onClose={() => setIsScratchPaperOpen(false)}
          onChange={setHasScratchStrokes}
        />
      )}
    </div>
  );
}
