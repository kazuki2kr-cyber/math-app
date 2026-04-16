'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { MathDisplay } from '@/components/MathDisplay';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Clock, ArrowRight, XCircle } from 'lucide-react';
import { parseOptions } from '@/lib/utils';

// Firestore から取得する生データ（answer_index を含む）
// answer_index は選択肢シャッフル処理のみに使用し、状態には保持しない
interface RawQuestion {
  id: string;
  question_text: string;
  options: string[];
  answer_index: number;
  explanation: string;
  image_url: string | null;
}

// 演習中に使う状態の型（answer_index を意図的に除外 → クライアントに正解位置を持たせない）
interface Question {
  id: string;
  question_text: string;
  options: string[]; // シャッフル済み
  image_url: string | null;
}

interface Unit {
  id: string;
  title: string;
  questions?: Question[];
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

  useEffect(() => {
    async function fetchUnit() {
      try {
        const snap = await getDoc(doc(db, 'units', unitId));
        if (snap.exists()) {
          const rawUnit = snap.data();

          let fetchedQuestions: RawQuestion[] = (rawUnit.questions as RawQuestion[]) || [];
          if (!rawUnit.questions || rawUnit.questions.length === 0) {
            const qSnap = await getDocs(query(collection(db, 'units', unitId, 'questions'), orderBy('order', 'asc')));
            fetchedQuestions = qSnap.docs.map(d => ({ id: d.id, ...d.data() } as RawQuestion));
          }

          const parsedQuestions: RawQuestion[] = fetchedQuestions.map(q => ({
            ...q,
            options: parseOptions(q.options as unknown as string),
          }));

          let filteredQuestions = [...parsedQuestions];
          const mode = new URLSearchParams(window.location.search).get('mode');

          if (mode === 'wrong' && user) {
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

          // 問題をシャッフルして最大10問を抽出
          const shuffledQuestions = fisherYatesShuffle(filteredQuestions).slice(0, 10);

          // 選択肢をシャッフル（answer_index はここでのみ参照し、状態には含めない）
          const finalQuestions: Question[] = shuffledQuestions.map((q) => ({
            id: q.id,
            question_text: q.question_text,
            options: fisherYatesShuffle(q.options),
            image_url: q.image_url ?? null,
            // answer_index は意図的に除外
          }));

          setUnit({ id: unitId, title: rawUnit.title, questions: finalQuestions });
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

  const handleSelectOption = (index: number) => {
    setSelectedOption(index);
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
        time: finalTime,
        answers: allAnswers,
      };

      sessionStorage.setItem('drillResult', JSON.stringify(drillResult));
      router.push(`/result/${unitId}`);
    }
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

  return (
    <div className="min-h-screen bg-[#F8FAEB] flex flex-col md:py-10 p-4">
      <div className="max-w-3xl mx-auto w-full space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" onClick={cancelDrill} className="text-muted-foreground hover:text-destructive transition-colors">
            <XCircle className="w-5 h-5 mr-1.5" strokeWidth={1.5} /> <span className="font-medium">中断する</span>
          </Button>
          <div className="flex items-center text-primary font-mono text-xl bg-primary/10 px-4 py-1.5 rounded-full border border-primary/20 shadow-inner">
            <Clock className="w-5 h-5 mr-2" />
            {Math.floor(elapsed / 60).toString().padStart(2, '0')}:{(elapsed % 60).toString().padStart(2, '0')}
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
          <CardFooter className="bg-gray-50/80 border-t p-6 flex justify-end">
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
    </div>
  );
}
