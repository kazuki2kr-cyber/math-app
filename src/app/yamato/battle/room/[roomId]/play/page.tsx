'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { ArrowLeft, CheckCircle2, Clock, Eraser, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { HandwritingCanvas, HandwritingCanvasRef } from '@/components/HandwritingCanvas';
import { useAuth } from '@/contexts/AuthContext';
import { functions, getRealtimeDb } from '@/lib/firebase';
import {
  BATTLE_ANSWER_LIMIT_MS,
  BATTLE_NEXT_QUESTION_COUNTDOWN_MS,
  BATTLE_QUESTION_COUNT,
} from '@/lib/battle';
import { useBattleClock } from '@/hooks/useBattleClock';
import { canAnswerKanji, kanjiBattleCall, kanjiBattleError } from '@/lib/kanjiBattle';
import { buildOcrPayload, getExpectedCharCount, OcrQuestionLayout } from '@/lib/kanjiOcr';

const KANJI_BATTLE_ROOM_PATH = 'kanjiBattleRooms';
const QUESTION_CACHE_PREFIX = 'kanji_battle_questions:v2';
const FINALIZE_RETRY_MAX = 5;
const FINALIZE_RETRY_BASE_MS = 2000;
const FINALIZE_RETRY_MAX_DELAY_MS = 30000;
const OCR_SUBMIT_RETRY_MAX = 3;
const OCR_SUBMIT_RETRY_BASE_MS = 3000;
const FINALIZE_TIMEOUT_MS = 90000;

interface AnswerRecord {
  uid: string;
  questionId: string;
  responseMs: number;
  answeredAtMs: number;
  submitted: true;
  timedOut?: boolean;
}

interface BattleRoom {
  schemaVersion?: number;
  matchId?: string;
  version?: number;
  phaseDeadlineMs?: number;
  status?: 'waiting' | 'active' | 'completed' | 'cancelled';
  phase?: 'loading' | 'answering' | 'countdown' | 'completed';
  currentQuestionIndex?: number;
  questionStartedAtMs?: number;
  countdownStartedAtMs?: number;
  completedAt?: number;
  unitId?: string;
  unitTitle?: string;
  hostUid?: string;
  participants?: Record<string, { uid: string; name: string; connected?: boolean; abandoned?: boolean; playReady?: boolean }>;
  questionAnswers?: Record<string, Record<string, AnswerRecord>>;
  playerScores?: Record<string, { score: number; submittedAt: number }>;
  results?: Record<string, unknown>;
  finalizedAt?: number;
}

interface BattleQuestion {
  id: string;
  question_text: string;
  image_url?: string | null;
  expectedCharCount: number;
  answer?: string;
}

function clampResponseMs(value: number) {
  if (!Number.isFinite(value)) return BATTLE_ANSWER_LIMIT_MS;
  return Math.min(BATTLE_ANSWER_LIMIT_MS, Math.max(0, Math.round(value)));
}

export default function KanjiBattlePlayPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const roomId = String(params.roomId || '');
  const [room, setRoom] = useState<BattleRoom | null>(null);
  const [questions, setQuestions] = useState<BattleQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasStrokes, setHasStrokes] = useState(false);
  const handwritingRef = useRef<Record<string, string>>({});
  const { nowMs, synchronized } = useBattleClock();
  const advanceAtRef = useRef(0);
  const readyRequestedRef = useRef(false);
  const imageStorageKey = 'kanji-battle-ink:v2:' + roomId + ':' + user?.uid;
  useEffect(() => {
    try { handwritingRef.current = JSON.parse(sessionStorage.getItem(imageStorageKey) || '{}'); }
    catch { handwritingRef.current = {}; }
  }, [imageStorageKey]);
  const [submitting, setSubmitting] = useState(false);
  const [ocrSubmitting, setOcrSubmitting] = useState(false);
  const [ocrSubmitted, setOcrSubmitted] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const canvasRef = useRef<HandwritingCanvasRef>(null);
  const lastQuestionIndexRef = useRef<number | null>(null);
  const redirectedToResultRef = useRef(false);
  const finalizeRequestedRef = useRef(false);
  const finalizeRetryCountRef = useRef(0);
  const finalizeRetryTimerRef = useRef<number | null>(null);
  const answerSubmittingRef = useRef(false);
  const ocrSubmittingRef = useRef(false);
  const ocrRetryCountRef = useRef(0);


  useEffect(() => {
    return () => {
      if (finalizeRetryTimerRef.current !== null) window.clearTimeout(finalizeRetryTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!roomId || !user) return;
    const realtimeDb = getRealtimeDb();
    const roomRef = ref(realtimeDb, `${KANJI_BATTLE_ROOM_PATH}/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const nextRoom = snapshot.exists() ? snapshot.val() : null;
      setRoom(nextRoom);
      if (nextRoom && nextRoom.schemaVersion !== 2) setError('画面を更新して新しいルームを作成してください。');
      if (nextRoom?.status === 'waiting') router.replace(`/yamato/battle/room/${roomId}`);
      if (nextRoom?.status === 'cancelled') router.replace('/yamato/battle');
      if (nextRoom?.finalizedAt && !redirectedToResultRef.current) {
        redirectedToResultRef.current = true;
        router.replace(`/yamato/battle/room/${roomId}/result`);
      }
    }, () => setError('ルームへのアクセスに失敗しました。一覧から参加してください。'));
    return () => unsubscribe();
  }, [roomId, router, user]);

  useEffect(() => {
    async function fetchQuestions() {
      if (!room?.unitId || !user) return;
      setLoading(true);
      setError(null);
      try {
        const questionCacheKey = `${QUESTION_CACHE_PREFIX}:${roomId}:${user?.uid || 'anonymous'}`;
        const cachedQuestions = sessionStorage.getItem(questionCacheKey);
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
        sessionStorage.setItem(questionCacheKey, JSON.stringify(nextQuestions));
        setQuestions(nextQuestions);
      } catch (err) {
        console.error('Failed to load kanji battle questions:', err);
        setError('漢字対戦用の問題を読み込めませんでした。');
      } finally {
        setLoading(false);
      }
    }

    fetchQuestions();
  }, [room?.unitId, roomId, user]);

  const currentQuestionIndex = Math.min(Number(room?.currentQuestionIndex || 0), Math.max(0, questions.length - 1));
  const currentQuestion = questions[currentQuestionIndex];
  const participantIds = useMemo(() => Object.keys(room?.participants || {}), [room?.participants]);
  const activeParticipantIds = useMemo(
    () => participantIds.filter(uid => !room?.participants?.[uid]?.abandoned),
    [participantIds, room?.participants]
  );
  const questionAnswers = room?.questionAnswers?.[String(currentQuestionIndex)] || {};
  const myAnswer = user ? questionAnswers[user.uid] : undefined;
  const questionStartedAtMs = Number(room?.questionStartedAtMs || nowMs);
  const countdownStartedAtMs = Number(room?.countdownStartedAtMs || nowMs);
  const elapsedMs = room?.phase === 'answering' ? clampResponseMs(nowMs - questionStartedAtMs) : 0;
  const remainingMs = room?.phase === 'answering' ? Math.max(0, BATTLE_ANSWER_LIMIT_MS - elapsedMs) : BATTLE_ANSWER_LIMIT_MS;
  const countdownRemainingMs = Math.max(0, BATTLE_NEXT_QUESTION_COUNTDOWN_MS - Math.max(0, nowMs - countdownStartedAtMs));
  const inBuffer = room?.phase === 'answering' && questionStartedAtMs > nowMs;
  const answeredCount = activeParticipantIds.filter(uid => !!questionAnswers[uid]).length;
  const currentAnswerCharCount = currentQuestion
    ? (currentQuestion.expectedCharCount || getExpectedCharCount())
    : 1;
  const currentAnswerText = typeof currentQuestion?.answer === 'string'
    ? currentQuestion.answer.trim()
    : '';

  const answerWindow = room?.schemaVersion === 2 && canAnswerKanji(room, nowMs, synchronized);
  const inputEnabled = answerWindow && !myAnswer && !submitting && !!user && !!room?.participants?.[user.uid] && !room.participants[user.uid].abandoned;

  const captureInk = (questionId: string) => {
    // A remounted, empty canvas must not replace an already captured answer.
    const dataURL = canvasRef.current?.hasStrokes() ? canvasRef.current.toDataURL() : null;
    if (dataURL) handwritingRef.current[questionId] = dataURL;
    try { sessionStorage.setItem(imageStorageKey, JSON.stringify(handwritingRef.current)); }
    catch { setError('手書きの一時保存に失敗しました。この画面を閉じずに対戦を続けてください。'); }
  };

  useLayoutEffect(() => {
    const questionId = currentQuestion?.id;
    if (!questionId) return;
    // Capture the outgoing canvas before React removes it (including question 10).
    return () => { captureInk(questionId); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id]);

  useEffect(() => {
    if (!answerWindow && currentQuestion) captureInk(currentQuestion.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerWindow, currentQuestion?.id]);

  useEffect(() => {
    if (lastQuestionIndexRef.current === currentQuestionIndex) return;
    lastQuestionIndexRef.current = currentQuestionIndex;
    setHasStrokes(false);
    canvasRef.current?.clear();
  }, [currentQuestionIndex]);

  useEffect(() => {
    if (!user || !room || room.phase !== 'loading' || !questions.length || !room.participants?.[user.uid] || room.participants[user.uid].playReady || readyRequestedRef.current) return;
    readyRequestedRef.current = true;
    void kanjiBattleCall('readyKanjiBattleRoom', { roomId, playReady: true }).catch(err => {
      readyRequestedRef.current = false;
      setError(kanjiBattleError(err));
    });
  }, [questions.length, room, roomId, user]);

  const writeAnswer = async () => {
    if (answerSubmittingRef.current || !inputEnabled || !user || !currentQuestion || !room) return;
    answerSubmittingRef.current = true;
    setSubmitting(true);
    const index = currentQuestionIndex;
    captureInk(currentQuestion.id);
    try {
      await kanjiBattleCall('submitKanjiBattleAnswer', {
        roomId, matchId: room.matchId, questionIndex: index, questionId: currentQuestion.id,
      });
    } catch (err) { setError(kanjiBattleError(err)); }
    finally { answerSubmittingRef.current = false; setSubmitting(false); }
  };

  const leaveBattle = async () => {
    try {
      await kanjiBattleCall('leaveKanjiBattleRoom', { roomId });
      sessionStorage.removeItem('kanji-battle-current-room');
      router.push('/yamato/battle');
    } catch (err) { setError(kanjiBattleError(err)); }
  };

  useEffect(() => {
    if (!room || !user || !room.participants?.[user.uid] || room.participants[user.uid].abandoned || !synchronized || !room.phaseDeadlineMs || nowMs < room.phaseDeadlineMs || nowMs < advanceAtRef.current) return;
    advanceAtRef.current = nowMs + 2000;
    void kanjiBattleCall('advanceKanjiBattleRoom', { roomId, matchId: room.matchId, version: room.version }).catch(err => setError(kanjiBattleError(err)));
  }, [room, user, roomId, nowMs, synchronized]);

  // 対戦完了後: 手書き画像を一括OCR送信
  useEffect(() => {
    async function submitOcr() {
      if (!user || !room || room.status !== 'completed' || ocrSubmittingRef.current || ocrSubmitted) return;
      if (!questions.length || !room.participants?.[user.uid] || room.participants[user.uid].abandoned) return;
      ocrSubmittingRef.current = true;
      setOcrSubmitting(true);
      setOcrError(null);
      try {
        const { composedImageBase64, layout } = await buildOcrPayload(
          questions.map(q => ({ id: q.id, expectedCharCount: q.expectedCharCount })),
          handwritingRef.current
        );
        const submitOcrFn = httpsCallable<
          { roomId: string; composedImageBase64: string; layout: OcrQuestionLayout[]; questionIds: string[] },
          { success: boolean; alreadySubmitted: boolean }
        >(functions, 'submitKanjiBattleOcr');
        await submitOcrFn({
          roomId,
          composedImageBase64,
          layout,
          questionIds: questions.map(q => q.id),
        });
        setOcrSubmitted(true);
        ocrRetryCountRef.current = 0;
      } catch (err) {
        console.error('OCR submission failed:', err);
        ocrSubmittingRef.current = false;
        const nextRetry = ocrRetryCountRef.current + 1;
        ocrRetryCountRef.current = nextRetry;
        if (nextRetry <= OCR_SUBMIT_RETRY_MAX) {
          const delay = Math.min(30000, OCR_SUBMIT_RETRY_BASE_MS * (2 ** (nextRetry - 1)));
          setOcrError(`採点の送信に失敗しました。${Math.ceil(delay / 1000)}秒後に再試行します...`);
          setTimeout(() => {
            setOcrSubmitting(false);
          }, delay);
          return;
        }
        setOcrError('採点の送信に失敗しました。しばらく待ってから結果画面を確認してください。');
      } finally {
        if (ocrSubmittingRef.current) {
          ocrSubmittingRef.current = false;
          setOcrSubmitting(false);
        }
      }
    }

    submitOcr();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrSubmitted, ocrSubmitting, room?.status, questions.length]);

  // Any remaining participant can finalize; the server transaction is idempotent.
  useEffect(() => {
    async function finalizeIfReady() {
      if (!user || !room || !room.participants?.[user.uid] || room.status !== 'completed' || room.finalizedAt || finalizing || finalizeRequestedRef.current) return;
      const activeNonAbandoned = activeParticipantIds.filter(uid => !room.participants?.[uid]?.abandoned);
      if (activeNonAbandoned.length === 0) return;

      const allHaveScores = activeNonAbandoned.every(uid => !!room.playerScores?.[uid]);
      const completedAt = Number(room.completedAt || 0);
      const timedOut = completedAt > 0 && (nowMs - completedAt) > FINALIZE_TIMEOUT_MS;

      if (!allHaveScores && !timedOut) return;

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

    finalizeIfReady();
  }, [activeParticipantIds, finalizing, nowMs, room, roomId, user]);

  const questionProgressPercent = (currentQuestionIndex / Math.max(1, questions.length)) * 100;
  const timerProgressPercent = room?.phase === 'countdown'
    ? Math.max(0, Math.min(100, (countdownRemainingMs / BATTLE_NEXT_QUESTION_COUNTDOWN_MS) * 100))
    : Math.max(0, Math.min(100, (remainingMs / BATTLE_ANSWER_LIMIT_MS) * 100));

  if (room?.status === 'completed') {
    return (
      <div className="min-h-screen bg-[#F8FAEB] p-4 md:p-8">
        <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 rounded-2xl border border-amber-100 bg-white p-8 text-center shadow-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-100 border-t-amber-500" />
          <div>
            <h1 className="text-xl font-black text-gray-900">
              {ocrSubmitting ? '手書き回答を採点しています...' : ocrSubmitted ? '結果を集計しています...' : '対戦終了'}
            </h1>
            <p className="mt-2 text-sm font-bold text-muted-foreground">
              {ocrSubmitted ? '集計が完了すると結果画面へ移動します。' : '採点が完了するまでお待ちください。'}
            </p>
          </div>
          {ocrError && (
            <div className="rounded-xl border border-orange-100 bg-orange-50 p-3 text-sm font-bold text-orange-700">
              {ocrError}
            </div>
          )}
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
            {!synchronized ? '同期中' : room?.phase === 'loading'
              ? '準備中'
              : inBuffer
                ? `スタート ${Math.ceil((questionStartedAtMs - nowMs) / 1000)}`
                : room?.phase === 'countdown'
                  ? `次へ ${Math.ceil(countdownRemainingMs / 1000)}`
                  : `残り ${Math.ceil(remainingMs / 1000)}`}
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

        {room && room.phase !== 'loading' && !answerWindow && (
          <div role="status" className="rounded-2xl border border-amber-100 bg-white p-10 text-center">
            {!synchronized ? '接続・時刻を確認しています…' : inBuffer
              ? 'まもなく問題を表示します'
              : room.phase === 'countdown' ? '次の問題を準備しています' : '回答受付を終了しました'}
          </div>
        )}
        {loading || !currentQuestion || room?.phase === 'loading' ? (
          <div className="flex justify-center py-20">
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-amber-100 bg-white p-8 text-center shadow-sm">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-100 border-t-amber-500" />
              <div>
                <h1 className="text-lg font-black text-gray-900">1問目を準備しています</h1>
                <p className="mt-1 text-sm font-bold text-muted-foreground">全員の準備後、3秒のカウントダウンで問題を表示します。</p>
              </div>
            </div>
          </div>
        ) : !room ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white/70 p-12 text-center text-sm font-bold text-muted-foreground">
            ルームが見つかりません。
          </div>
        ) : (
          <Card hidden={!answerWindow} style={!answerWindow ? { display: 'none' } : undefined} className="shadow-2xl border-0 overflow-hidden bg-white/95 backdrop-blur-sm">
            <div className="h-2 w-full bg-primary/80" />
            <CardHeader className="px-8 pt-8 pb-4">
              <CardDescription className="font-bold text-primary tracking-widest uppercase text-sm mb-2">
                Question {currentQuestionIndex + 1} <span className="opacity-50 mx-1">/</span> {questions.length}
                {isAdmin && currentAnswerText && (
                  <span className="ml-2 text-[10px] font-medium tracking-normal text-primary/25 align-middle">
                    ・ {currentAnswerText}
                  </span>
                )}
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
            <CardContent className="px-8 pb-4">
              {currentQuestion.image_url && (
                <div className="mb-6 bg-gray-50 p-6 rounded-xl flex justify-center border shadow-inner">
                  {/* eslint-disable-next-line @next/next/no-img-element -- worksheet images retain their original aspect ratio */}
                  <img src={currentQuestion.image_url} alt="問題画像" className="max-h-60 object-contain rounded-md shadow-sm mix-blend-multiply" />
                </div>
              )}

              {/* 手書き入力エリア */}
              <div className="flex flex-col items-center gap-3">
                <p className="text-xs text-muted-foreground font-bold">
                  ※複数文字の場合は「横書き」で書いてください。
                </p>
                <div className={`relative w-full aspect-[3/1] shadow-inner rounded-xl border-2 bg-white transition-all ${
                  myAnswer ? 'border-green-300 opacity-70' : 'border-dashed border-amber-200'
                }`}>
                  {/* ガイド線 */}
                  <div className="absolute inset-0 pointer-events-none border border-orange-100 flex items-center justify-center rounded-xl overflow-hidden">
                    <div className="w-full h-full absolute border-[0.5px] border-orange-900/10 top-1/2 -translate-y-1/2 border-dashed" />
                    {Array.from({ length: Math.max(0, currentAnswerCharCount - 1) }).map((_, dividerIndex) => {
                      const left = `${((dividerIndex + 1) / currentAnswerCharCount) * 100}%`;
                      return (
                        <div
                          key={dividerIndex}
                          className="h-full absolute border-[0.5px] border-orange-900/10 border-dashed"
                          style={{ left, transform: 'translateX(-50%)' }}
                        />
                      );
                    })}
                  </div>
                  <HandwritingCanvas
                    key={currentQuestion.id}
                    ref={canvasRef}
                    readOnly={!inputEnabled}
                    onChange={setHasStrokes}
                    strokeWidth={8}
                    strokeColor="#1a1a1a"
                    className="w-full h-full bg-transparent !border-none !rounded-none !shadow-none"
                  />
                  {myAnswer && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl pointer-events-none">
                      <div className="bg-green-100/80 rounded-full p-3">
                        <CheckCircle2 className="h-8 w-8 text-green-600" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 w-full max-w-xs">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!inputEnabled}
                    onClick={() => canvasRef.current?.undo()}
                    className="flex-1 text-orange-900 border-orange-200 hover:bg-orange-50"
                  >
                    <Undo2 className="w-4 h-4 mr-1" />
                    戻す
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!inputEnabled}
                    onClick={() => { canvasRef.current?.clear(); setHasStrokes(false); }}
                    className="flex-1 text-orange-900 border-orange-200 hover:bg-orange-50"
                  >
                    <Eraser className="w-4 h-4 mr-1" />
                    クリア
                  </Button>
                </div>
              </div>
            </CardContent>

            <CardFooter className="bg-gray-50/80 border-t p-6 flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center">
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                {myAnswer && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                {myAnswer
                  ? myAnswer.timedOut
                    ? '時間切れです。次の問題へ自動で進みます。'
                    : '送信済みです。次の問題へ自動で進みます。'
                  : '書き終えたら「回答する」を押してください。'}
              </div>
              <Button
                onClick={() => writeAnswer()}
                disabled={!hasStrokes || !inputEnabled}
                size="lg"
                className="h-14 px-10 text-lg font-bold shadow-lg transition-all hover:-translate-y-0.5"
              >
                {myAnswer ? '送信済み' : submitting ? '送信中...' : '回答する'}
              </Button>
            </CardFooter>
          </Card>
        )}
      </main>
    </div>
  );
}
