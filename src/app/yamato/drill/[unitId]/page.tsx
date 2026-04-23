'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { db, functions } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { HandwritingCanvas, HandwritingCanvasRef } from '@/components/HandwritingCanvas';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowRight, Eraser, Check, Loader2, Undo2, X } from 'lucide-react';

interface Question {
  id: string;
  question_text: string;
  answer: string;
  answer_index?: number | string;
  options?: unknown[];
  explanation?: string;
  [key: string]: unknown;
}

interface OcrSlotLayout {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OcrQuestionLayout {
  questionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  expectedCharCount: number;
  slots: OcrSlotLayout[];
}

interface SynthesizedImageResult {
  composedImageBase64: string;
  layout: OcrQuestionLayout[];
}

interface KanjiQuestionResult {
  id: string;
  recognizedText: string;
  correctOptionText: string;
  question_text: string;
}

interface KanjiBatchResponse {
  success: boolean;
  score: number;
  isHighScore: boolean;
  isLevelUp: boolean;
  oldLevel: number;
  newLevel: number;
  xpGain: number;
  newTotalXp: number;
  correctQuestions: KanjiQuestionResult[];
  wrongQuestions: KanjiQuestionResult[];
  recognizedChars?: Array<{ text: string; x: number; y: number }>;
}

function getExpectedCharCount(answer?: string): number {
  const normalized = (answer || '').normalize('NFKC').replace(/\s+/g, '');
  return Math.max(1, Array.from(normalized).length || 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function KanjiDrillPageWrapper({ params }: { params: Promise<{ unitId: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FDF6E3] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-900" /></div>}>
      <KanjiDrillPage params={params} />
    </Suspense>
  );
}

function KanjiDrillPage({ params }: { params: Promise<{ unitId: string }> }) {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode');
  const { unitId } = React.use(params);
  const canvasRef = useRef<HandwritingCanvasRef>(null);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [unitTitle, setUnitTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({}); // questionId -> dataURL
  const [startTime, setStartTime] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // 1問でも解いていて、かつ提出中でなければ離脱警告を出す
      if (currentIndex > 0 && !isSubmitting) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentIndex, isSubmitting]);

  useEffect(() => {
    if (!user) return;

    async function loadUnit() {
      const decodedUnitId = decodeURIComponent(unitId);

      if (decodedUnitId === 'sample-kanji-1') {
        setUnitTitle('一年生のかん字（一）');
        setQuestions([
          { id: 'k1-1', question_text: '明日は<u>がっこう</u>に行く。', answer: '学校', options: ['学校'], explanation: '「がっこう」と読みます。' },
          { id: 'k1-2', question_text: '<u>せんせい</u>に挨拶する。', answer: '先生', options: ['先生'], explanation: '「せんせい」と読みます。' },
          { id: 'k1-3', question_text: '<u>こくご</u>の辞書を引く。', answer: '国語', options: ['国語'], explanation: '「こくご」と読みます。' },
        ]);
        setStartTime(Date.now());
        setLoading(false);
        return;
      }

      try {
        const unitDoc = await getDoc(doc(db, 'units', decodedUnitId));
        if (!unitDoc.exists()) {
          alert('単元が見つかりません');
          router.push('/yamato');
          return;
        }

        const data = unitDoc.data();
        setUnitTitle(data.title || '漢字ドリル');

        let qs: Question[] = [];
        if (data.questions && Array.isArray(data.questions)) {
          qs = data.questions;
        } else {
          // fetch from subcollection if not in array
          const subQs = await getDocs(collection(db, `units/${decodedUnitId}/questions`));
          qs = subQs.docs.map(d => ({ id: d.id, ...d.data() } as Question));
        }

        // Filtering for 'wrong' mode
        if (mode === 'wrong') {
          const userDoc = await getDoc(doc(db, 'users', user!.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            const wrongIds = userData.kanjiUnitStats?.[decodedUnitId]?.wrongQuestionIds || [];
            if (wrongIds.length > 0) {
              qs = qs.filter(q => wrongIds.includes(q.id));
            }
          }
        }

        // シャッフルして最大10問をランダムに抽出する
        let qsToUse = [...qs];
        for (let i = qsToUse.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [qsToUse[i], qsToUse[j]] = [qsToUse[j], qsToUse[i]];
        }
        qsToUse = qsToUse.slice(0, 10);

        setQuestions(qsToUse);
        setStartTime(Date.now());
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    loadUnit();
  }, [mode, router, unitId, user]);

  const handleNext = async () => {
    if (!canvasRef.current || !hasStrokes || isSubmitting || isSubmittingRef.current) return;

    const currentQ = questions[currentIndex];
    const dataURL = canvasRef.current.toDataURL();
    
    let newAnswers = answers;
    if (dataURL) {
      newAnswers = { ...answers, [currentQ.id]: dataURL };
      setAnswers(newAnswers);
    }

    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setHasStrokes(false);
      // Timeout is needed to let the new canvas clear properly
      setTimeout(() => canvasRef.current?.clear(), 0);
    } else {
      // 最終問題なら提出処理へ
      await handleSubmit(newAnswers);
    }
  };

  const synthesizeImages = async (currentAnswers: Record<string, string>): Promise<string> => {
    // 境界判定のミスを防ぐため、縦1列 (COLUMNS=1) に戻す。
    // その代わりセル間のマージンを 100px と大きく取り、上下の誤認を防ぐ。
    const ROWS = questions.length;
    const CELL_WIDTH = 600; 
    const CELL_HEIGHT = 300;
    const MARGIN = 100; // 上下の回答が混じらないよう大きなマージンを設定

    const canvas = document.createElement('canvas');
    canvas.width = CELL_WIDTH;
    canvas.height = ROWS * CELL_HEIGHT + (ROWS - 1) * MARGIN;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return '';
    
    // 背景を白で塗りつぶす
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const loadImage = (src: string): Promise<HTMLImageElement> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = src;
      });
    };

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const dataURL = currentAnswers[q.id];
      if (!dataURL) continue;

      const img = await loadImage(dataURL);
      const targetX = 0;
      const targetY = i * (CELL_HEIGHT + MARGIN);

      // アスペクト比を維持して中央に配置 (contain相当)
      const scale = Math.min(CELL_WIDTH / img.width, CELL_HEIGHT / img.height);
      const drawWidth = img.width * scale;
      const drawHeight = img.height * scale;
      const offsetX = (CELL_WIDTH - drawWidth) / 2;
      const offsetY = (CELL_HEIGHT - drawHeight) / 2;

      ctx.drawImage(img, targetX + offsetX, targetY + offsetY, drawWidth, drawHeight);
    }

    return canvas.toDataURL('image/jpeg', 0.82);
  };
  void synthesizeImages;

  const buildOcrPayload = async (currentAnswers: Record<string, string>): Promise<SynthesizedImageResult> => {
    const columns = questions.length > 4 ? 2 : 1;
    const rows = Math.ceil(questions.length / columns);
    const cellWidth = 640;
    const cellHeight = 320;
    const gridGapX = 48;
    const gridGapY = 56;
    const pagePadding = 40;
    const slotGap = 36;
    const slotHeight = 220;
    const slotPaddingX = 44;
    const slotPaddingY = 50;

    const canvas = document.createElement('canvas');
    canvas.width = pagePadding * 2 + columns * cellWidth + Math.max(0, columns - 1) * gridGapX;
    canvas.height = pagePadding * 2 + rows * cellHeight + Math.max(0, rows - 1) * gridGapY;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return { composedImageBase64: '', layout: [] };
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;

    const loadImage = (src: string): Promise<HTMLImageElement> => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load handwriting image'));
        img.src = src;
      });
    };

    const getInkBounds = (img: HTMLImageElement) => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) {
        return { x: 0, y: 0, width: img.width, height: img.height };
      }

      tempCtx.drawImage(img, 0, 0);
      const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
      const { data, width, height } = imageData;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const alpha = data[idx + 3];
          const isInk = alpha > 0 && (data[idx] < 245 || data[idx + 1] < 245 || data[idx + 2] < 245);
          if (!isInk) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      if (maxX < 0 || maxY < 0) {
        return { x: 0, y: 0, width: img.width, height: img.height };
      }

      const pad = 12;
      return {
        x: clamp(minX - pad, 0, width - 1),
        y: clamp(minY - pad, 0, height - 1),
        width: clamp(maxX - minX + 1 + pad * 2, 1, width),
        height: clamp(maxY - minY + 1 + pad * 2, 1, height),
      };
    };

    const layout: OcrQuestionLayout[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const dataURL = currentAnswers[q.id];
      if (!dataURL) continue;

      const gridColumn = i % columns;
      const gridRow = Math.floor(i / columns);
      const cellX = pagePadding + gridColumn * (cellWidth + gridGapX);
      const cellY = pagePadding + gridRow * (cellHeight + gridGapY);
      const expectedCharCount = getExpectedCharCount(q.answer);
      const slotCount = Math.max(1, expectedCharCount);
      const slotAreaWidth = cellWidth - slotPaddingX * 2;
      const slotWidth = slotCount === 1
        ? Math.min(260, slotAreaWidth)
        : (slotAreaWidth - slotGap * (slotCount - 1)) / slotCount;
      const slotStartX = cellX + (cellWidth - (slotWidth * slotCount + slotGap * (slotCount - 1))) / 2;
      const slotY = cellY + slotPaddingY;
      const slots: OcrSlotLayout[] = [];

      for (let slotIndex = 0; slotIndex < slotCount; slotIndex++) {
        const slotX = slotStartX + slotIndex * (slotWidth + slotGap);
        slots.push({
          index: slotIndex,
          x: slotX / canvas.width,
          y: slotY / canvas.height,
          width: slotWidth / canvas.width,
          height: slotHeight / canvas.height,
        });
      }

      layout.push({
        questionId: q.id,
        x: cellX / canvas.width,
        y: cellY / canvas.height,
        width: cellWidth / canvas.width,
        height: cellHeight / canvas.height,
        expectedCharCount,
        slots,
      });

      const img = await loadImage(dataURL);
      const inkBounds = getInkBounds(img);
      const inkWidth = Math.max(1, inkBounds.width);
      const inkHeight = Math.max(1, inkBounds.height);
      const answerAreaX = slotStartX;
      const answerAreaY = slotY;
      const answerAreaWidth = slotWidth * slotCount + slotGap * (slotCount - 1);
      const answerAreaHeight = slotHeight;
      const scale = Math.min(answerAreaWidth / inkWidth, answerAreaHeight / inkHeight) * 0.9;
      const drawWidth = inkWidth * scale;
      const drawHeight = inkHeight * scale;
      const drawX = answerAreaX + (answerAreaWidth - drawWidth) / 2;
      const centeredDrawY = answerAreaY + (answerAreaHeight - drawHeight) / 2;
      const upwardBias = Math.min(answerAreaHeight * 0.08, 16);
      const drawY = Math.max(answerAreaY, centeredDrawY - upwardBias);

      ctx.drawImage(
        img,
        inkBounds.x,
        inkBounds.y,
        inkWidth,
        inkHeight,
        drawX,
        drawY,
        drawWidth,
        drawHeight
      );
    }

    return {
      composedImageBase64: canvas.toDataURL('image/png'),
      layout,
    };
  };

  const handleSubmit = async (currentAnswers: Record<string, string>) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    const timeSpentString = ((Date.now() - startTime) / 1000).toFixed(0);
    const timeSpent = parseInt(timeSpentString);

    try {
      const { composedImageBase64, layout } = await buildOcrPayload(currentAnswers);
      
      let resultData: KanjiBatchResponse;

      // 検証用: 環境変数または特定条件下でモック動作をさせる
      if (process.env.NEXT_PUBLIC_USE_MOCK_OCR === 'true') {
        console.log('Using Mock OCR result for design check');
        const correctCount = questions.length > 0 ? questions.length - 1 : 0;
        const mockScore = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
        
        resultData = {
          success: true,
          score: mockScore,
          isHighScore: true,
          isLevelUp: false,
          oldLevel: 1,
          newLevel: 1,
          xpGain: correctCount * 60,
          newTotalXp: correctCount * 60,
          correctQuestions: questions.slice(0, -1).map(q => ({ 
            id: q.id, 
            recognizedText: q.answer || '山', 
            correctOptionText: q.answer || '山',
            question_text: q.question_text 
          })),
          wrongQuestions: questions.slice(-1).map(q => ({ 
            id: q.id, 
            recognizedText: '無回答', 
            correctOptionText: q.answer || '川',
            question_text: q.question_text 
          })),
        };
      } else {
        const recognizeFn = httpsCallable<
          { unitId: string; composedImageBase64: string; questionIds: string[]; layout: OcrQuestionLayout[] },
          KanjiBatchResponse
        >(functions, 'recognizeKanjiBatch');
        const decodedUnitId = decodeURIComponent(unitId);
        const response = await recognizeFn({
          unitId: decodedUnitId,
          composedImageBase64: composedImageBase64,
          questionIds: questions.map(q => q.id),
          layout,
        });
        resultData = response.data;
      }
      
      // 結果画面に渡すすためにセッションストレージに保存
      sessionStorage.setItem('kanji_last_result', JSON.stringify({
        ...resultData,
        time: timeSpent
      }));

      // デバッグ用に提出した画像も一部表示できるよう保存
      sessionStorage.setItem('kanji_composed_image', composedImageBase64);

      router.push(`/yamato/result/${unitId}`);
      
    } catch (e: unknown) {
      console.error(e);
      const message =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string'
            ? e.message
            : '不明なエラー';
      alert(`提出中にエラーが発生しました: ${message}`);
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  const cancelDrill = () => {
    if (confirm('演習を中断してダッシュボードに戻りますか？')) {
      router.push('/yamato');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDF6E3] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-900" />
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="min-h-screen bg-[#FDF6E3] flex items-center justify-center font-serif text-orange-900">
        問題が見つかりません。
      </div>
    );
  }

  const currentQ = questions[currentIndex];
  const currentAnswerCharCount = getExpectedCharCount(currentQ.answer);
  // 問題文の表示（問題の該当箇所が「〇〇」などの場合、そこを対象として表示）
  const text = currentQ.question_text || 'この漢字を書いてください';
  const progress = ((currentIndex + 1) / questions.length) * 100;

  return (
    <div className="min-h-screen bg-[#FDF6E3] flex flex-col font-serif">
      <header className="bg-white/95 border-b border-orange-900/10 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2 md:gap-3">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={cancelDrill} 
            className="text-orange-900/50 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <X className="w-5 h-5 mr-1" />
            <span className="font-bold">中断する</span>
          </Button>
          <h1 className="text-lg font-bold text-orange-950 truncate max-w-[180px] md:max-w-md ml-2">{unitTitle}</h1>
        </div>
        <div className="text-sm font-bold text-orange-900/70">
          {currentIndex + 1} <span className="font-normal opacity-60">/ {questions.length}</span>
        </div>
      </header>
      
      {/* ProgressBar */}
      <div className="w-full h-1 bg-orange-100">
        <div className="h-full bg-orange-600 transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      <main className="flex-1 flex flex-col items-center justify-start p-4 overflow-y-auto">
        <Card className="w-full max-w-xl border-orange-900/20 shadow-xl bg-white">
          <div className="p-8 text-center bg-orange-50/50 border-b border-orange-100 min-h-[140px] flex items-center justify-center flex-col">
            {/* 漢字問題のテキスト。問題によってはフリガナや対象文字をハイライトする処理を後で入れる想定 */}
            <h2 className="text-2xl md:text-3xl font-black text-gray-900 leading-relaxed tracking-widest text-center"
                dangerouslySetInnerHTML={{ __html: text.replace(/([一-龠]+)/g, '<span class="text-orange-900 border-b-2 border-orange-400">$1</span>') }}
            />

          </div>
          
          <div className="p-4 md:p-6 flex flex-col items-center">
            {/* 手書きキャンバス エリア */}
            <p className="text-xs text-orange-900/60 font-bold mb-3 text-center">
              ※回答が複数文字の場合は、この枠内に「横書き」で書いてください。
            </p>
            <div className="relative w-full aspect-[2/1] group shadow-inner rounded-xl border-2 border-dashed border-orange-200 bg-white">
              {/* 十字線のガイド（漢字書き取りノート風） */}
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
                ref={canvasRef} 
                onChange={(hasStrictStrokes) => setHasStrokes(hasStrictStrokes)}
                strokeWidth={8}
                strokeColor="#1a1a1a"
                className="w-full h-full bg-transparent !border-none !rounded-none !shadow-none"
              />
            </div>

            {/* コントロール群 */}
            <div className="flex justify-between w-full max-w-[340px] mt-6 gap-3">
              <Button 
                variant="outline" 
                onClick={() => canvasRef.current?.undo()}
                className="flex-1 text-orange-900 border-orange-200 hover:bg-orange-50 hover:border-orange-300"
              >
                <Undo2 className="w-4 h-4 mr-2" />
                戻す
              </Button>
              <Button 
                variant="outline" 
                onClick={() => { canvasRef.current?.clear(); setHasStrokes(false); }}
                className="flex-1 text-orange-900 border-orange-200 hover:bg-orange-50 hover:border-orange-300"
              >
                <Eraser className="w-4 h-4 mr-2" />
                クリア
              </Button>
            </div>
            
            {/* 次へボタン */}
            <div className="w-full max-w-[340px] mt-4">
              <Button 
                onClick={handleNext}
                disabled={!hasStrokes || isSubmitting}
                className="w-full h-14 text-lg font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-md disabled:bg-orange-200 disabled:text-orange-400"
              >
                {isSubmitting ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> 送信中...</>
                ) : currentIndex === questions.length - 1 ? (
                  <><Check className="w-5 h-5 mr-2" /> 採点する</>
                ) : (
                  <>次へ <ArrowRight className="w-5 h-5 ml-2" /></>
                )}
              </Button>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
