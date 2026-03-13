'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { MathDisplay } from '@/components/MathDisplay';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Clock, ArrowRight, XCircle } from 'lucide-react';

interface Question {
  id: string;
  question_text: string;
  options: string[];
  answer_index: number;
  explanation: string;
  image_url: string | null;
}

interface Unit {
  id: string;
  title: string;
  questions: Question[];
}

export default function DrillPage() {
  const params = useParams();
  const unitId = params.unitId as string;
  const router = useRouter();

  const [unit, setUnit] = useState<Unit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drill State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]); // true if correct, false if wrong
  const [wrongQuestions, setWrongQuestions] = useState<Question[]>([]);
  const [correctQuestions, setCorrectQuestions] = useState<Question[]>([]);
  
  // Timer State
  const [startTime, setStartTime] = useState<number>(0);
  const [elapsed, setElapsed] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    async function fetchUnit() {
      try {
        const snap = await getDoc(doc(db, 'units', unitId));
        if (snap.exists()) {
          setUnit(snap.data() as Unit);
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
    fetchUnit();
  }, [unitId]);

  useEffect(() => {
    // Start interval
    if (unit && currentIndex < unit.questions.length) {
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

    const currentQ = unit.questions[currentIndex];
    // answer_index is 1-based in CSV
    const isCorrect = selectedOption + 1 === currentQ.answer_index;

    // Save answer result
    setAnswers(prev => [...prev, isCorrect]);
    if (isCorrect) {
      setCorrectQuestions(prev => [...prev, currentQ]);
    } else {
      setWrongQuestions(prev => [...prev, currentQ]);
    }

    if (currentIndex < unit.questions.length - 1) {
      // Go to next question
      setSelectedOption(null);
      setCurrentIndex(currentIndex + 1);
    } else {
      // Finish Drill
      if (timerRef.current) clearInterval(timerRef.current);
      const finalTime = Math.floor((Date.now() - startTime) / 1000);
      
      const newAnswers = [...answers, isCorrect];
      const newCorrect = isCorrect ? [...correctQuestions, currentQ] : correctQuestions;
      const newWrong = !isCorrect ? [...wrongQuestions, currentQ] : wrongQuestions;
      
      const finalScore = Math.floor((newCorrect.length / unit.questions.length) * 100);

      // Save drill results to session storage so result page can pick it up
      const drillResult = {
        unitId,
        unitTitle: unit.title,
        totalQuestions: unit.questions.length,
        score: finalScore,
        time: finalTime,
        correctQuestions: newCorrect,
        wrongQuestions: newWrong,
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

  if (error || !unit || unit.questions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <p className="text-destructive mb-4">{error || '問題データがありません。'}</p>
        <Button onClick={() => router.push('/')}>ダッシュボードへ</Button>
      </div>
    );
  }

  const currentQ = unit.questions[currentIndex];
  // Calculate progress safely
  const progressPercent = ((currentIndex) / unit.questions.length) * 100;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:p-8 p-4">
      <div className="max-w-3xl mx-auto w-full space-y-4">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <Button variant="ghost" size="sm" onClick={cancelDrill} className="text-muted-foreground hover:text-destructive">
            <XCircle className="w-4 h-4 mr-1" /> 中断
          </Button>
          <div className="flex items-center text-primary font-mono text-lg bg-primary/10 px-3 py-1 rounded-full">
            <Clock className="w-4 h-4 mr-2" />
            {Math.floor(elapsed / 60).toString().padStart(2, '0')}:{(elapsed % 60).toString().padStart(2, '0')}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
          <div 
            className="bg-primary h-full transition-all duration-300 ease-out" 
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Question Card */}
        <Card className="shadow-sm border-t-4 border-t-primary">
          <CardHeader>
            <CardDescription className="font-semibold text-primary">
              問題 {currentIndex + 1} / {unit.questions.length}
            </CardDescription>
            <CardTitle className="text-xl leading-relaxed mt-2 pt-2">
              <MathDisplay math={currentQ.question_text} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-6">
            {currentQ.image_url && (
              <div className="mb-4 bg-muted/30 p-4 rounded-md flex justify-center">
                <img src={currentQ.image_url} alt="Problem visual" className="max-h-64 object-contain rounded-sm" />
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {currentQ.options.map((opt, i) => {
                const isSelected = selectedOption === i;
                return (
                  <button
                    key={i}
                    onClick={() => handleSelectOption(i)}
                    className={`
                      w-full text-left p-4 rounded-lg border-2 transition-all 
                      ${isSelected 
                        ? 'border-primary bg-primary/5 shadow-md scale-[1.01]' 
                        : 'border-muted bg-white hover:border-primary/50 hover:bg-gray-50'
                      }
                    `}
                  >
                    <span className="inline-block w-6 h-6 text-center leading-6 rounded-full bg-muted/50 text-muted-foreground text-sm mr-3">
                      {i + 1}
                    </span>
                    <MathDisplay math={opt} />
                  </button>
                );
              })}
            </div>
          </CardContent>
          <CardFooter className="bg-gray-50 rounded-b-lg border-t p-4 flex justify-end">
            <Button 
              size="lg" 
              disabled={selectedOption === null} 
              onClick={handleNext}
              className="px-8 font-bold"
            >
              {currentIndex < unit.questions.length - 1 ? '次の問題へ' : '演習を完了する'}
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </CardFooter>
        </Card>

      </div>
    </div>
  );
}
