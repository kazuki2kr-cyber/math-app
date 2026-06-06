'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { MathDisplay } from '@/components/MathDisplay';
import { HandwritingCanvas, HandwritingCanvasRef } from '@/components/HandwritingCanvas';
import { ScratchPaperOverlay } from '@/components/ScratchPaperOverlay';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Clock, ArrowRight, XCircle, ChevronLeft, NotebookPen, Eraser, PenLine, RotateCcw, Trash2 } from 'lucide-react';
import { parseOptions } from '@/lib/utils';

const STANDARD_DRILL_QUESTION_COUNT = 10;
const DRILL_DATA_CACHE_PREFIX = 'math_drill_data_cache_v1:';
const DRILL_DATA_CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000;
const STROKE_WIDTH_OPTIONS = [
  { id: 'standard', label: '標準', width: 4 },
  { id: 'thin', label: '細い', width: 2.5 },
  { id: 'extraThin', label: 'かなり細い', width: 1.5 },
] as const;
const ERASER_SIZE_OPTIONS = [
  { id: 'small', label: '小', width: 18 },
  { id: 'medium', label: '中', width: 28 },
  { id: 'large', label: '大', width: 42 },
] as const;

type DrillMode = 'standard' | 'wrong' | 'all';
type DrillType = 'multiple_choice' | 'written';
type StrokeWidthId = (typeof STROKE_WIDTH_OPTIONS)[number]['id'];
type EraserSizeId = (typeof ERASER_SIZE_OPTIONS)[number]['id'];
type ScratchTool = 'pen' | 'eraser';

// Firestore から取得する生データ（answer_index を含む）
// answer_index は選択肢シャッフル処理のみに使用し、状態には保持しない
interface RawQuestion {
  id: string;
  question_text: string;
  options: string[] | string;
  answer_index?: number;
  explanation?: string;
  image_url: string | null;
  questionType?: DrillType;
}

// 演習中に使う状態の型（answer_index を意図的に除外 → クライアントに正解位置を持たせない）
interface Question {
  id: string;
  question_text: string;
  options: string[]; // シャッフル済み
  image_url: string | null;
  questionType?: DrillType;
}

interface Unit {
  id: string;
  title: string;
  questions?: Question[];
  mode: DrillMode;
  drillType?: DrillType;
  writtenAttemptLimit?: number;
}

interface CachedDrillData {
  timestamp: number;
  unit: {
    title: string;
    drillType?: DrillType;
  };
  questions: RawQuestion[];
}

type ParsedRawQuestion = Omit<RawQuestion, 'options'> & { options: string[] };

function getDrillDataCacheKey(unitId: string) {
  return `${DRILL_DATA_CACHE_PREFIX}${unitId}`;
}

function readCachedDrillData(unitId: string): CachedDrillData | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = localStorage.getItem(getDrillDataCacheKey(unitId));
    if (!cached) return null;

    const parsed = JSON.parse(cached) as CachedDrillData;
    if (Date.now() - parsed.timestamp >= DRILL_DATA_CACHE_EXPIRY_MS) return null;
    if (!parsed.unit?.title || !Array.isArray(parsed.questions)) return null;
    return parsed;
  } catch (err) {
    console.error('Failed to parse drill data cache', err);
    localStorage.removeItem(getDrillDataCacheKey(unitId));
    return null;
  }
}

function writeCachedDrillData(unitId: string, rawUnit: any, questions: RawQuestion[]) {
  if (typeof window === 'undefined') return;

  const cacheData: CachedDrillData = {
    timestamp: Date.now(),
    unit: {
      title: String(rawUnit.title || unitId),
      drillType: rawUnit.drillType === 'written' ? 'written' : 'multiple_choice',
    },
    questions: questions.map(({ answer_index, explanation, ...question }) => question),
  };

  try {
    localStorage.setItem(getDrillDataCacheKey(unitId), JSON.stringify(cacheData));
  } catch (err) {
    console.error('Failed to write drill data cache', err);
  }
}

export default function DrillPage() {
  const params = useParams();
  const unitId = decodeURIComponent(params.unitId as string);
  const router = useRouter();
  const { user } = useAuth();

  const [unit, setUnit] = useState<Unit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drill State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  // 各問題インデックスに対して選択した選択肢インデックスを保持（「戻る」時の復元用）
  const [questionSelections, setQuestionSelections] = useState<Record<number, number>>({});
  // 選択した選択肢テキストのみ記録（正誤はサーバーが判定）
  const [submittedAnswers, setSubmittedAnswers] = useState<{ questionId: string; selectedOptionText: string }[]>([]);
  const [isCompleting, setIsCompleting] = useState(false);
  const isCompletingRef = useRef(false);
  // attemptId は演習開始時に一度だけ生成（連打時も同一IDでサーバー冪等性チェックが機能する）
  const attemptIdRef = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString() + Math.random().toString(36).substring(2)
  );

  // Timer State
  const [startTime, setStartTime] = useState<number>(0);
  const [elapsed, setElapsed] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [isScratchPaperOpen, setIsScratchPaperOpen] = useState(false);
  const [hasScratchStrokes, setHasScratchStrokes] = useState(false);
  const scratchPaperRef = useRef<HandwritingCanvasRef>(null);
  const writtenPageRefs = useRef<Array<HandwritingCanvasRef | null>>([]);
  const [writtenPageCount, setWrittenPageCount] = useState(1);
  const [activeWrittenPage, setActiveWrittenPage] = useState(0);
  const [writtenHasStrokes, setWrittenHasStrokes] = useState(false);
  const [writtenTool, setWrittenTool] = useState<ScratchTool>('pen');
  const [writtenStrokeWidthId, setWrittenStrokeWidthId] = useState<StrokeWidthId>('standard');
  const [writtenEraserSizeId, setWrittenEraserSizeId] = useState<EraserSizeId>('medium');
  const selectedWrittenStrokeWidth = STROKE_WIDTH_OPTIONS.find((option) => option.id === writtenStrokeWidthId)?.width ?? 4;
  const selectedWrittenEraserWidth = ERASER_SIZE_OPTIONS.find((option) => option.id === writtenEraserSizeId)?.width ?? 28;
  const currentQuestionId = unit?.questions?.[currentIndex]?.id ?? null;

  const refreshWrittenHasStrokes = () => {
    setWrittenHasStrokes(writtenPageRefs.current.slice(0, writtenPageCount).some(ref => ref?.hasStrokes()));
  };

  const getSeenHistoryKey = () => `math_seen_questions_v1:${user?.uid || 'guest'}:${unitId}`;

  const readSeenQuestionIds = () => {
    if (typeof window === 'undefined') return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(getSeenHistoryKey()) || '[]');
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };

  const recordSeenQuestionIds = (questionIds: string[]) => {
    if (typeof window === 'undefined' || unit?.mode === 'wrong') return;
    const current = readSeenQuestionIds();
    const merged = Array.from(new Set([...current, ...questionIds]));
    localStorage.setItem(getSeenHistoryKey(), JSON.stringify(merged.slice(-500)));
  };

  useEffect(() => {
    async function fetchUnit() {
      try {
        const cachedDrillData = readCachedDrillData(unitId);
        let rawUnit: any | null = null;
        let fetchedQuestions: RawQuestion[] = [];

        if (cachedDrillData) {
          rawUnit = cachedDrillData.unit;
          fetchedQuestions = cachedDrillData.questions;
        } else {
          const snap = await getDoc(doc(db, 'units', unitId));
          if (snap.exists()) {
            rawUnit = snap.data();
            fetchedQuestions = (rawUnit.questions as RawQuestion[]) || [];

            if (!rawUnit.questions || rawUnit.questions.length === 0) {
              const qSnap = await getDocs(query(collection(db, 'units', unitId, 'questions'), orderBy('order', 'asc')));
              fetchedQuestions = qSnap.docs.map(d => ({ id: d.id, ...d.data() } as RawQuestion));
            }

            writeCachedDrillData(unitId, rawUnit, fetchedQuestions);
          }
        }

        if (rawUnit) {
          const parsedQuestions: ParsedRawQuestion[] = fetchedQuestions.map(q => ({
            ...q,
            options: parseOptions(q.options as unknown as string),
          }));

          let filteredQuestions = [...parsedQuestions];
          const rawMode = new URLSearchParams(window.location.search).get('mode');
          const mode: DrillMode = rawMode === 'wrong' ? 'wrong' : rawMode === 'all' ? 'all' : 'standard';
          const drillType: DrillType = rawUnit.drillType === 'written' ? 'written' : 'multiple_choice';

          if (mode === 'wrong' && user && drillType !== 'written') {
            const userDocRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userDocRef);
            if (userSnap.exists() && userSnap.data().unitStats?.[unitId]) {
              const wrongIds = userSnap.data().unitStats[unitId].wrongQuestionIds || [];
              filteredQuestions = filteredQuestions.filter(q => wrongIds.includes(q.id));
              if (filteredQuestions.length === 0) {
                setError('間違えた問題がありません。復習完了です！');
                setLoading(false);
                return;
              }
            } else {
              setError('間違えた問題の履歴がありません。');
              setLoading(false);
              return;
            }
          }

          // Fisher-Yates シャッフル（.sort(() => Math.random() - 0.5) は重複が生じる既知のバグのため使用しない）
          const fisherYatesShuffle = <T,>(arr: T[]): T[] => {
            const a = [...arr];
            for (let i = a.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
          };

          let selectedQuestions: ParsedRawQuestion[];
          if (drillType === 'written') {
            selectedQuestions = filteredQuestions.slice(0, 1);
          } else if (mode === 'all') {
            selectedQuestions = fisherYatesShuffle(filteredQuestions);
          } else if (mode === 'standard') {
            const seenIds = new Set(readSeenQuestionIds());
            const unseenQuestions = filteredQuestions.filter(q => !seenIds.has(String(q.id)));
            const seenQuestions = filteredQuestions.filter(q => seenIds.has(String(q.id)));

            if (unseenQuestions.length === 0) {
              localStorage.removeItem(getSeenHistoryKey());
              selectedQuestions = fisherYatesShuffle(filteredQuestions).slice(0, STANDARD_DRILL_QUESTION_COUNT);
            } else {
              selectedQuestions = [
                ...fisherYatesShuffle(unseenQuestions),
                ...fisherYatesShuffle(seenQuestions),
              ].slice(0, STANDARD_DRILL_QUESTION_COUNT);
            }
          } else {
            selectedQuestions = fisherYatesShuffle(filteredQuestions).slice(0, STANDARD_DRILL_QUESTION_COUNT);
          }

          // 選択肢をシャッフル（answer_index はここでのみ参照し、状態には含めない）
          const finalQuestions: Question[] = selectedQuestions.map((q) => ({
            id: q.id,
            question_text: q.question_text,
            options: fisherYatesShuffle(q.options),
            image_url: q.image_url ?? null,
            questionType: q.questionType || drillType,
            // answer_index は意図的に除外
          }));

          setUnit({
            id: unitId,
            title: rawUnit.title,
            questions: finalQuestions,
            mode,
            drillType,
            writtenAttemptLimit: Math.max(2, Number(rawUnit.writtenAttemptLimit) || 2),
          });
          setStartTime(Date.now());
        } else {
          setError('指定された単元が見つかりません。');
        }
      } catch (err: any) {
        setError('データの読み込みに失敗しました。');
      } finally {
        setLoading(false);
      }
    }

    if (user !== undefined) {
      fetchUnit();
    }
  }, [unitId, user]);

  useEffect(() => {
    if (unit && unit.questions && currentIndex < unit.questions.length) {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [unit, currentIndex, startTime]);

  useEffect(() => {
    if (!currentQuestionId) return;

    setIsScratchPaperOpen(false);
    scratchPaperRef.current?.clear();
    setHasScratchStrokes(false);
  }, [currentQuestionId]);

  const handleSelectOption = (index: number) => {
    setSelectedOption(index);
    setQuestionSelections(prev => ({ ...prev, [currentIndex]: index }));
  };

  const handleBack = () => {
    if (currentIndex === 0 || isCompleting) return;
    const prevIndex = currentIndex - 1;
    // 提出済み回答から最後のエントリを取り除く
    setSubmittedAnswers(prev => prev.slice(0, -1));
    // 前の問題の選択状態を復元
    setSelectedOption(questionSelections[prevIndex] ?? null);
    setCurrentIndex(prevIndex);
  };

  const handleNext = () => {
    if (selectedOption === null || !unit) return;

    const questions = unit.questions || [];
    const currentQ = questions[currentIndex];
    const selectedText = currentQ.options[selectedOption];

    // 選択した選択肢テキストを記録（正誤判定はしない）
    const currentAnswer = { questionId: currentQ.id, selectedOptionText: selectedText };
    const allAnswers = [...submittedAnswers, currentAnswer];
    setSubmittedAnswers(allAnswers);

    if (currentIndex < (unit.questions?.length || 0) - 1) {
      setSelectedOption(null);
      setCurrentIndex(currentIndex + 1);
    } else {
      // 最終問題 — 連打防止
      if (isCompletingRef.current) return;
      isCompletingRef.current = true;
      setIsCompleting(true);

      if (timerRef.current) clearInterval(timerRef.current);
      const finalTime = Math.floor((Date.now() - startTime) / 1000);

      // サーバーに送るデータ（スコア・XP・正誤情報は一切含めない）
      const drillResult = {
        attemptId: attemptIdRef.current,
        unitId,
        unitTitle: unit.title,
        totalQuestions: unit.questions?.length || 0,
        mode: unit.mode,
        time: finalTime,
        answers: allAnswers,
      };

      recordSeenQuestionIds(allAnswers.map(answer => answer.questionId));
      sessionStorage.setItem('drillResult', JSON.stringify(drillResult));
      router.push(`/result/${unitId}`);
    }
  };

  const composeWrittenAnswerImage = async (pageImages: string[]) => {
    const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load answer page'));
      img.src = src;
    });

    const images = await Promise.all(pageImages.map(loadImage));
    const trimImage = (img: HTMLImageElement) => {
      const source = document.createElement('canvas');
      source.width = img.width;
      source.height = img.height;
      const sourceCtx = source.getContext('2d');
      if (!sourceCtx) return source;
      sourceCtx.fillStyle = '#ffffff';
      sourceCtx.fillRect(0, 0, source.width, source.height);
      sourceCtx.drawImage(img, 0, 0);

      const imageData = sourceCtx.getImageData(0, 0, source.width, source.height);
      const data = imageData.data;
      let minX = source.width;
      let minY = source.height;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < source.height; y += 1) {
        for (let x = 0; x < source.width; x += 1) {
          const index = (y * source.width + x) * 4;
          const alpha = data[index + 3];
          const isInk = alpha > 16 && (data[index] < 248 || data[index + 1] < 248 || data[index + 2] < 248);
          if (!isInk) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      if (maxX < 0 || maxY < 0) return source;

      const margin = 96;
      const cropX = Math.max(0, minX - margin);
      const cropY = Math.max(0, minY - margin);
      const cropRight = Math.min(source.width, maxX + margin + 1);
      const cropBottom = Math.min(source.height, maxY + margin + 1);
      const cropWidth = cropRight - cropX;
      const cropHeight = cropBottom - cropY;

      if (cropWidth <= 0 || cropHeight <= 0) return source;

      const trimmed = document.createElement('canvas');
      trimmed.width = cropWidth;
      trimmed.height = cropHeight;
      const trimmedCtx = trimmed.getContext('2d');
      if (!trimmedCtx) return source;
      trimmedCtx.fillStyle = '#ffffff';
      trimmedCtx.fillRect(0, 0, cropWidth, cropHeight);
      trimmedCtx.drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      return trimmed;
    };

    const trimmedPages = images.map(trimImage);
    if (trimmedPages.length === 1) return trimmedPages[0].toDataURL('image/png');

    const gap = 36;
    const width = Math.max(...trimmedPages.map(page => page.width));
    const height = trimmedPages.reduce((sum, page) => sum + page.height, 0) + gap * (trimmedPages.length - 1);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to compose answer image');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    let y = 0;
    trimmedPages.forEach((page) => {
      ctx.drawImage(page, (width - page.width) / 2, y);
      y += page.height + gap;
    });

    return canvas.toDataURL('image/png');
  };

  const handleWrittenSubmit = async () => {
    if (!unit || isCompleting) return;
    const question = unit.questions?.[0];
    if (!question) return;

    const activeRefs = writtenPageRefs.current.slice(0, writtenPageCount);
    if (!activeRefs.some(ref => ref?.hasStrokes())) {
      alert('解答欄に途中式や答えを書いてから提出してください。');
      return;
    }

    const pageImages = activeRefs
      .map(ref => ref?.hasStrokes() ? ref.toDataURL() : null)
      .filter((value): value is string => Boolean(value));
    if (pageImages.length === 0) {
      alert('解答画像の作成に失敗しました。もう一度お試しください。');
      return;
    }

    let answerImageDataUrl = '';
    try {
      answerImageDataUrl = await composeWrittenAnswerImage(pageImages);
    } catch {
      alert('解答画像の作成に失敗しました。もう一度お試しください。');
      return;
    }

    if (timerRef.current) clearInterval(timerRef.current);
    const finalTime = Math.floor((Date.now() - startTime) / 1000);
    const writtenResult = {
      type: 'written',
      attemptId: attemptIdRef.current,
      unitId,
      unitTitle: unit.title,
      totalQuestions: 1,
      questionId: question.id,
      questionText: question.question_text,
      time: finalTime,
      answerImageDataUrl,
    };

    isCompletingRef.current = true;
    setIsCompleting(true);
    sessionStorage.setItem('drillResult', JSON.stringify(writtenResult));
    router.push(`/result/${unitId}`);
  };

  const cancelDrill = () => {
    if (confirm('演習を中断してダッシュボードに戻りますか？')) {
      router.push('/');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full font-bold"></div>
      </div>
    );
  }

  if (error || !unit || !unit.questions || unit.questions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <p className="text-destructive mb-4">{error || '問題データがありません。'}</p>
        <Button onClick={() => router.push('/')}>ダッシュボードへ</Button>
      </div>
    );
  }

  const questions = unit.questions || [];
  const currentQ = questions[currentIndex];
  const progressPercent = (currentIndex / (questions.length || 1)) * 100;

  if (unit.drillType === 'written') {
    return (
      <div className="min-h-screen bg-[#F8FAEB] flex flex-col md:py-10 p-4">
        <div className="max-w-5xl mx-auto w-full space-y-5">
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={cancelDrill} className="text-muted-foreground hover:text-destructive transition-colors">
              <XCircle className="w-5 h-5 mr-1.5" strokeWidth={1.5} />
              <span className="font-medium">中断する</span>
            </Button>
            <div className="flex items-center text-primary font-mono text-lg sm:text-xl bg-primary/10 px-3 sm:px-4 py-1.5 rounded-full border border-primary/20 shadow-inner">
              <Clock className="w-5 h-5 mr-2" />
              {Math.floor(elapsed / 60).toString().padStart(2, '0')}:{(elapsed % 60).toString().padStart(2, '0')}
            </div>
          </div>

          <Card className="shadow-xl border-0 overflow-hidden bg-white">
            <div className="h-2 w-full bg-primary/80"></div>
            <CardHeader className="px-6 sm:px-8 pt-7 pb-4">
              <CardDescription className="font-bold text-primary tracking-widest uppercase text-sm mb-2">
                Written Event
                <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                  1問 / 最大{unit.writtenAttemptLimit || 2}回
                </span>
              </CardDescription>
              <CardTitle className="text-2xl leading-relaxed text-gray-900 font-medium">
                <MathDisplay math={currentQ.question_text} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 px-4 sm:px-8 pb-6">
              {currentQ.image_url && (
                <div className="bg-gray-50 p-5 rounded-xl flex justify-center border shadow-inner">
                  <img src={currentQ.image_url} alt="Problem visual" className="max-h-72 object-contain rounded-md shadow-sm mix-blend-multiply" />
                </div>
              )}
              <div className="rounded-xl border border-primary/10 bg-primary/5 p-3 text-xs font-medium text-primary">
                途中式・考え方・答えをこの解答欄にまとめて書いてください。提出後、AIが100点満点で採点し、改善ポイントを返します。
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-2">
                <div className="inline-flex rounded-lg border bg-white p-1 shadow-sm">
                  {Array.from({ length: writtenPageCount }).map((_, index) => (
                    <Button
                      key={index}
                      type="button"
                      size="sm"
                      variant={activeWrittenPage === index ? 'default' : 'ghost'}
                      onClick={() => setActiveWrittenPage(index)}
                      className="h-8 px-3 text-xs"
                    >
                      {index + 1}ページ
                    </Button>
                  ))}
                </div>
                {writtenPageCount < 2 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setWrittenPageCount(2);
                      setActiveWrittenPage(1);
                    }}
                  >
                    2ページ目を追加
                  </Button>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-lg border bg-white p-1 shadow-sm">
                    {STROKE_WIDTH_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        aria-label={`ペンの太さ: ${option.label}`}
                        aria-pressed={writtenStrokeWidthId === option.id}
                        onClick={() => {
                          setWrittenStrokeWidthId(option.id);
                          setWrittenTool('pen');
                        }}
                        className={`h-8 rounded-md px-2 text-xs font-bold transition-colors ${
                          writtenStrokeWidthId === option.id && writtenTool === 'pen'
                            ? 'bg-primary text-white shadow-sm'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant={writtenTool === 'pen' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setWrittenTool('pen')}
                    className="h-10 px-3"
                  >
                    <PenLine className="h-4 w-4 md:mr-2" />
                    <span className="hidden md:inline">ペン</span>
                  </Button>
                  <Button
                    type="button"
                    variant={writtenTool === 'eraser' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setWrittenTool('eraser')}
                    className="h-10 px-3"
                  >
                    <Eraser className="h-4 w-4 md:mr-2" />
                    <span className="hidden md:inline">消しゴム</span>
                  </Button>
                  <div className="inline-flex rounded-lg border bg-white p-1 shadow-sm">
                    {ERASER_SIZE_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        aria-label={`消しゴムのサイズ: ${option.label}`}
                        aria-pressed={writtenEraserSizeId === option.id}
                        onClick={() => {
                          setWrittenEraserSizeId(option.id);
                          setWrittenTool('eraser');
                        }}
                        className={`h-8 min-w-8 rounded-md px-2 text-xs font-bold transition-colors ${
                          writtenEraserSizeId === option.id && writtenTool === 'eraser'
                            ? 'bg-primary text-white shadow-sm'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!writtenHasStrokes}
                    onClick={() => {
                      writtenPageRefs.current[activeWrittenPage]?.undo();
                      setTimeout(refreshWrittenHasStrokes, 0);
                    }}
                    className="h-10 px-3"
                  >
                    <RotateCcw className="h-4 w-4 md:mr-2" />
                    <span className="hidden md:inline">戻す</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!writtenHasStrokes}
                    onClick={() => {
                      writtenPageRefs.current[activeWrittenPage]?.clear();
                      setTimeout(refreshWrittenHasStrokes, 0);
                    }}
                    className="h-10 px-3"
                  >
                    <Trash2 className="h-4 w-4 md:mr-2" />
                    <span className="hidden md:inline">このページを消す</span>
                  </Button>
                </div>
              </div>
              <div className="h-[58vh] min-h-[420px] overflow-hidden rounded-xl border bg-white">
                <div className="relative h-full w-full">
                  {Array.from({ length: writtenPageCount }).map((_, index) => (
                    <div
                      key={index}
                      className={`absolute inset-0 ${activeWrittenPage === index ? 'z-10 opacity-100' : 'z-0 opacity-0 pointer-events-none'}`}
                      aria-hidden={activeWrittenPage !== index}
                    >
                      <HandwritingCanvas
                        ref={(node) => { writtenPageRefs.current[index] = node; }}
                        width="100%"
                        height="100%"
                        strokeWidth={selectedWrittenStrokeWidth}
                        strokeColor="#111827"
                        tool={writtenTool}
                        eraserWidth={selectedWrittenEraserWidth}
                        onChange={refreshWrittenHasStrokes}
                        className="h-full w-full !rounded-none !border-0 !shadow-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
            <CardFooter className="bg-gray-50/80 border-t p-5 flex justify-end items-center">
              <Button
                size="lg"
                disabled={isCompleting}
                onClick={handleWrittenSubmit}
                className="px-8 h-13 text-base font-bold shadow-lg"
              >
                {isCompleting ? '提出中...' : '解答を提出する'}
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAEB] flex flex-col md:py-10 p-4">
      <div className="max-w-3xl mx-auto w-full space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <Button variant="ghost" size="sm" onClick={cancelDrill} className="text-muted-foreground hover:text-destructive transition-colors">
            <XCircle className="w-5 h-5 mr-1.5" strokeWidth={1.5} /> <span className="font-medium">中断する</span>
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
            <div className="flex items-center text-primary font-mono text-lg sm:text-xl bg-primary/10 px-3 sm:px-4 py-1.5 rounded-full border border-primary/20 shadow-inner">
              <Clock className="w-5 h-5 mr-2" />
              {Math.floor(elapsed / 60).toString().padStart(2, '0')}:{(elapsed % 60).toString().padStart(2, '0')}
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-black/5 h-2.5 rounded-full overflow-hidden shadow-inner">
          <div
            className="bg-primary h-full transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Question Card */}
        <Card className="shadow-2xl border-0 overflow-hidden bg-white/95 backdrop-blur-sm">
          <div className="h-2 w-full bg-primary/80"></div>
          <CardHeader className="px-8 pt-8 pb-4">
            <CardDescription className="font-bold text-primary tracking-widest uppercase text-sm mb-2">
              Question {currentIndex + 1} <span className="opacity-50 mx-1">/</span> {unit.questions?.length || 0}
              {unit.mode === 'all' && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">全問</span>}
              {unit.mode === 'standard' && <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-[10px] text-green-700">未出題優先</span>}
            </CardDescription>
            <CardTitle className="text-2xl leading-relaxed text-gray-900 font-medium">
              <MathDisplay math={currentQ.question_text} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 px-8 pb-8">
            {currentQ.image_url && (
              <div className="mb-6 bg-gray-50 p-6 rounded-xl flex justify-center border shadow-inner">
                <img src={currentQ.image_url} alt="Problem visual" className="max-h-72 object-contain rounded-md shadow-sm mix-blend-multiply" />
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {currentQ.options.map((opt, i) => {
                const isSelected = selectedOption === i;
                return (
                  <button
                    key={i}
                    onClick={() => handleSelectOption(i)}
                    className={`
                      w-full text-left p-5 rounded-xl border-2 transition-all duration-200
                      ${isSelected
                        ? 'border-primary bg-primary/5 shadow-md scale-[1.02] ring-2 ring-primary/20'
                        : 'border-gray-200 bg-white hover:border-primary/50 hover:bg-gray-50 hover:shadow-sm'
                      }
                    `}
                  >
                    <div className="flex items-start">
                      <span className={`flex-shrink-0 inline-block w-8 h-8 text-center leading-8 rounded-full text-sm font-bold mr-4 transition-colors ${isSelected ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500'}`}>
                        {i + 1}
                      </span>
                      <div className="pt-1 overflow-visible">
                        <MathDisplay math={opt} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
          <CardFooter className="bg-gray-50/80 border-t p-6 flex justify-between items-center">
            <Button
              variant="ghost"
              size="lg"
              disabled={currentIndex === 0 || isCompleting}
              onClick={handleBack}
              className="px-6 h-14 text-base font-medium text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="w-5 h-5 mr-1" />
              前の問題へ
            </Button>
            <Button
              size="lg"
              disabled={selectedOption === null || isCompleting}
              onClick={handleNext}
              className="px-10 h-14 text-lg font-bold shadow-lg transition-all hover:-translate-y-0.5"
            >
              {currentIndex < (unit.questions?.length || 0) - 1 ? '次の問題へ' : (isCompleting ? '処理中...' : '演習を完了する')}
              <ArrowRight className="w-6 h-6 ml-3" />
            </Button>
          </CardFooter>
        </Card>

      </div>
      <ScratchPaperOverlay
        ref={scratchPaperRef}
        open={isScratchPaperOpen}
        questionText={currentQ.question_text}
        questionNumber={currentIndex + 1}
        totalQuestions={unit.questions?.length || 0}
        onClose={() => setIsScratchPaperOpen(false)}
        onChange={setHasScratchStrokes}
      />
    </div>
  );
}
