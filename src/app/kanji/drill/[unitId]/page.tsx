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
  options?: any;
  explanation?: string;
  [key: string]: any;
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
          router.push('/kanji');
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
  }, [user, unitId, router]);

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
    // 2列×N行の格子レイアウトに変更。
    // 解答エリアのアスペクト比 (2:1) を維持するため、横600px、縦300pxのセルを使用。
    const COLUMNS = 2;
    const ROWS = Math.ceil(questions.length / COLUMNS);
    const CELL_WIDTH = 600; 
    const CELL_HEIGHT = 300;
    const MARGIN = 40; // 認識ミスを防ぐため広めのマージン

    const canvas = document.createElement('canvas');
    canvas.width = COLUMNS * CELL_WIDTH + (COLUMNS - 1) * MARGIN;
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
      const col = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      
      const x = col * (CELL_WIDTH + MARGIN);
      const y = row * (CELL_HEIGHT + MARGIN);
      
      // アスペクト比を維持して描画（HandwritingCanvasが2:1であることを期待）
      ctx.drawImage(img, x, y, CELL_WIDTH, CELL_HEIGHT);
    }

    return canvas.toDataURL('image/jpeg', 0.85);
  };

  const handleSubmit = async (currentAnswers: Record<string, string>) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    const timeSpentString = ((Date.now() - startTime) / 1000).toFixed(0);
    const timeSpent = parseInt(timeSpentString);

    try {
      const composedImageBase64 = await synthesizeImages(currentAnswers);
      
      let resultData: any;

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
        const recognizeFn = httpsCallable<{ unitId: string; composedImageBase64: string; questionIds: string[] }, any>(functions, 'recognizeKanjiBatch');
        const decodedUnitId = decodeURIComponent(unitId);
        const response = await recognizeFn({
          unitId: decodedUnitId,
          composedImageBase64: composedImageBase64,
          questionIds: questions.map(q => q.id)  // 出題した10問のIDを順番通りに渡す
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

      router.push(`/kanji/result/${unitId}`);
      
    } catch (e: any) {
      console.error(e);
      alert(`提出中にエラーが発生しました: ${e.message || '不明なエラー'}`);
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  const cancelDrill = () => {
    if (confirm('演習を中断してダッシュボードに戻りますか？')) {
      router.push('/kanji');
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
                <div className="w-full h-full absolute border-[0.5px] border-orange-900/10 left-1/2 -translate-x-1/2 border-dashed" />
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
