'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { MathDisplay } from '@/components/MathDisplay';
import confetti from 'canvas-confetti';
import { Copy, ArrowLeft, Trophy, Sparkles, CheckCircle2, XCircle } from 'lucide-react';

interface ResultData {
  unitId: string;
  unitTitle: string;
  totalQuestions: number;
  score: number;
  time: number;
  correctQuestions: any[];
  wrongQuestions: any[];
}

export default function ResultPage() {
  const params = useParams();
  const unitId = params.unitId as string;
  const router = useRouter();
  const { user } = useAuth();
  
  const [result, setResult] = useState<ResultData | null>(null);
  const [isHighScore, setIsHighScore] = useState(false);
  const [saving, setSaving] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function processResult() {
      if (!user) return;
      
      const stored = sessionStorage.getItem('drillResult');
      if (!stored) {
        // Results not found, redirect to dashboard or drill
        router.push('/');
        return;
      }

      const parsed: ResultData = JSON.parse(stored);
      setResult(parsed);

      // Check and update high score
      try {
        const scoreRef = doc(db, 'scores', `${user.uid}_${unitId}`);
        const snap = await getDoc(scoreRef);
        
        let newHighScore = false;
        if (snap.exists()) {
          const currentData = snap.data();
          if (parsed.score > currentData.maxScore || (parsed.score === currentData.maxScore && parsed.time < currentData.bestTime)) {
            newHighScore = true;
          }
        } else {
          newHighScore = true;
        }

        if (newHighScore) {
          setIsHighScore(true);
          // Play confetti
          confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#22c55e', '#3b82f6', '#eab308', '#ec4899']
          });

          await setDoc(scoreRef, {
            uid: user.uid,
            unitId: unitId,
            maxScore: parsed.score,
            bestTime: parsed.time,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
      } catch (err) {
        console.error('Failed to save score:', err);
      } finally {
        setSaving(false);
      }
    }

    processResult();
  }, [user, unitId, router]);

  const generatePrompt = () => {
    if (!result) return '';
    
    const correctList = result.correctQuestions.map((q, i) => `${i + 1}. ${q.question_text}`).join('\n');
    const wrongList = result.wrongQuestions.map((q, i) => `${i + 1}. ${q.question_text}\n   解説: ${q.explanation}`).join('\n\n');

    return `
あなたは優秀なプロの塾講師・数学アドバイザーです。
中学1年生の生徒が「${result.unitTitle}」の演習ドリルを完了しました。

結果: ${result.score}点（${result.totalQuestions}問中 ${result.correctQuestions.length}問 正解）
所要時間: ${result.time}秒

【正解した問題】
${correctList || '（なし）'}

【不正解だった問題】
${wrongList || '（なし）'}

上記のデータから、以下の3点を出力してください。
1. この生徒の「強み」と「弱み」の具体的な分析
2. 弱点を克服するためのアドバイスや着眼点
3. 弱点を補強するための類題（解説付きで2問程度）

中学生に話しかけるような、優しく励ますトーンでお願いします。
`.trim();
  };

  const handleCopyPrompt = async () => {
    const promptText = generatePrompt();
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  if (saving || !result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col p-4 md:p-8">
      <div className="max-w-4xl mx-auto w-full space-y-6">
        
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => router.push('/')}>
            <ArrowLeft className="w-4 h-4 mr-2" /> ダッシュボードに戻る
          </Button>
        </div>

        {/* Score Header */}
        <Card className={`overflow-hidden border-2 ${isHighScore ? 'border-yellow-400 bg-yellow-50/30 shadow-yellow-100' : 'border-primary/20'}`}>
          <CardContent className="p-8 text-center flex flex-col items-center">
            {isHighScore && (
              <div className="mb-4 inline-flex items-center gap-2 bg-yellow-100 text-yellow-800 px-4 py-1.5 rounded-full text-sm font-bold animate-bounce">
                <Trophy className="w-4 h-4" /> 最高得点更新!!
              </div>
            )}
            <h2 className="text-2xl font-bold text-muted-foreground mb-2">
              「{result.unitTitle}」 演習結果
            </h2>
            <div className="text-6xl font-extrabold text-primary my-4 flex items-baseline justify-center gap-2">
              {result.score}
              <span className="text-2xl text-muted-foreground font-normal"> / 100点</span>
            </div>
            <p className="text-lg text-muted-foreground">
              解答時間: {Math.floor(result.time / 60)}分 {result.time % 60}秒
            </p>
          </CardContent>
        </Card>

        {/* AI Advisor Prompt generator */}
        <Card className="shadow-sm border-t-4 border-t-blue-500">
          <CardHeader>
            <CardTitle className="flex items-center text-blue-700">
              <Sparkles className="w-5 h-5 mr-2" />
              AIに弱点分析を依頼する
            </CardTitle>
            <CardDescription>
              結果を元に作られたプロンプトを外部のAIチャット（GeminiやChatGPT等）に貼り付けて、個別アドバイスをもらいましょう。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-100 p-4 rounded-md text-sm text-gray-700 whitespace-pre-wrap font-mono h-32 overflow-y-auto border border-gray-200">
              {generatePrompt()}
            </div>
          </CardContent>
          <CardFooter className="flex justify-end pt-0">
            <Button onClick={handleCopyPrompt} className={copied ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}>
              {copied ? <CheckCircle2 className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              {copied ? 'コピーしました！' : 'プロンプトをコピー'}
            </Button>
          </CardFooter>
        </Card>

        {/* Question Review */}
        <div className="space-y-4">
          <h3 className="text-xl font-bold mt-8 mb-4">問題の振り返り</h3>
          
          {result.wrongQuestions.length > 0 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-destructive flex items-center">
                <XCircle className="w-5 h-5 mr-2" />
                間違えた問題
              </h4>
              {result.wrongQuestions.map((q, i) => (
                <Card key={`wrong-${i}`} className="border-l-4 border-l-destructive">
                  <CardHeader className="py-3">
                    <CardTitle className="text-base font-normal">
                      <MathDisplay math={q.question_text} />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="bg-red-50/50 py-3 text-sm">
                    <p className="font-semibold text-destructive mb-1">解説:</p>
                    <MathDisplay math={q.explanation || '解説がありません。'} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {result.correctQuestions.length > 0 && (
            <div className="space-y-4 mt-8">
              <h4 className="font-semibold text-green-600 flex items-center">
                <CheckCircle2 className="w-5 h-5 mr-2" />
                正解した問題
              </h4>
              {result.correctQuestions.map((q, i) => (
                <Card key={`correct-${i}`} className="border-l-4 border-l-green-500 opacity-80">
                  <CardHeader className="py-3">
                    <CardTitle className="text-base font-normal">
                      <MathDisplay math={q.question_text} />
                    </CardTitle>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
