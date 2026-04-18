'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { MathDisplay } from '@/components/MathDisplay';
const fireConfetti = (opts: object) => import('canvas-confetti').then(m => m.default(opts));
import { Copy, ArrowLeft, Trophy, Sparkles, CheckCircle2, XCircle, ArrowUpCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { getAvailableIcons, getTitleForLevel } from '@/lib/xp';

// sessionStorage に保存されている演習データ（クライアントは正誤情報を持たない）
interface StoredDrillData {
  attemptId?: string;
  unitId: string;
  unitTitle: string;
  totalQuestions: number;
  time: number;
  answers: Array<{ questionId: string; selectedOptionText: string }>;
}

// サーバーから返ってくる正解問題
interface CorrectQuestion {
  id: string;
  question_text: string;
}

// サーバーから返ってくる不正解問題
interface WrongQuestion {
  id: string;
  question_text: string;
  selectedOptionText: string;
  correctOptionText: string;
  explanation: string;
  options: string[];
}

interface XpDetails {
  base: number;
  combo: number;
  multiplier: number;
  multiplierBonus: number;
  finalXp: number;
}

export default function ResultPage() {
  const params = useParams();
  const unitId = decodeURIComponent(params.unitId as string);
  const router = useRouter();
  const { user } = useAuth();

  const [storedData, setStoredData] = useState<StoredDrillData | null>(null);
  const [score, setScore] = useState<number>(0);
  const [xpDetails, setXpDetails] = useState<XpDetails | null>(null);
  const [correctQuestions, setCorrectQuestions] = useState<CorrectQuestion[]>([]);
  const [wrongQuestions, setWrongQuestions] = useState<WrongQuestion[]>([]);

  const [isHighScore, setIsHighScore] = useState(false);
  const [saving, setSaving] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [levelUpData, setLevelUpData] = useState<{ oldLevel: number, newLevel: number, icon: string, title: string } | null>(null);
  const processedRef = React.useRef(false);

  const processResult = useCallback(async () => {
    if (!user) return;

    const stored = sessionStorage.getItem('drillResult');
    if (!stored) {
      router.push('/');
      return;
    }

    const parsed: StoredDrillData = JSON.parse(stored);

    // 旧形式（answers フィールドなし）のデータが残っていた場合は破棄してダッシュボードへ
    if (!Array.isArray(parsed.answers)) {
      sessionStorage.removeItem('drillResult');
      router.push('/');
      return;
    }

    setStoredData(parsed);
    setError(null);
    setSaving(true);

    // 連打防止（sessionStorage はリロード対応のため残す）
    if (processedRef.current) return;
    processedRef.current = true;

    try {
      const functions = getFunctions(undefined, 'us-central1');
      const process = httpsCallable(functions, 'processDrillResult');

      // 15秒のタイムアウト処理
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 15000)
      );

      const resultResponse = await Promise.race([
        process({
          attemptId: parsed.attemptId,
          unitId,
          unitTitle: parsed.unitTitle,
          time: parsed.time,
          answers: parsed.answers,
        }),
        timeoutPromise
      ]) as any;

      const data = resultResponse.data as {
        success: boolean;
        isHighScore: boolean;
        isLevelUp: boolean;
        newLevel: number;
        oldLevel: number;
        score: number;
        xpDetails: XpDetails;
        correctQuestions: CorrectQuestion[];
        wrongQuestions: WrongQuestion[];
      };

      if (data.success) {
        setScore(data.score);
        setXpDetails(data.xpDetails);
        setCorrectQuestions(data.correctQuestions || []);
        setWrongQuestions(data.wrongQuestions || []);

        // 短期ロードマップ対応：演習完了時にユニットデータのキャッシュをクリアし、ダッシュボードでの最新反映を保証する
        localStorage.removeItem('math_units_cache');

        if (data.isHighScore) {
          setIsHighScore(true);
          if (!data.isLevelUp) {
            fireConfetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#22c55e', '#3b82f6', '#eab308'] });
          }
        }

        if (data.isLevelUp) {
          const newIcons = getAvailableIcons(data.newLevel);
          const newlyUnlockedIcon = newIcons[newIcons.length - 1] || '🎓';
          setLevelUpData({
            oldLevel: data.oldLevel,
            newLevel: data.newLevel,
            icon: newlyUnlockedIcon,
            title: getTitleForLevel(data.newLevel)
          });
          fireConfetti({ particleCount: 200, spread: 100, origin: { y: 0.5 }, colors: ['#ffd700', '#ff0000', '#00ff00', '#0000ff'] });
        }
      } else {
        setError('データの保存に失敗しました。');
      }

    } catch (err: any) {
      console.error('Failed to process drill result:', err);
      processedRef.current = false; // 再試行を可能にする
      if (err.message === 'TIMEOUT') {
        setError('通信がタイムアウトしました。通信環境を確認して、再試行してください。');
      } else {
        setError('サーバーとの通信中にエラーが発生しました。');
      }
    } finally {
      setSaving(false);
    }
  }, [user, unitId, router, fireConfetti]);

  useEffect(() => {
    processResult();
  }, [processResult]);

  const generatePrompt = () => {
    if (!storedData) return '';

    const correctList = correctQuestions.map((q, i) => `${i + 1}. ${q.question_text}`).join('\n');
    const wrongList = wrongQuestions.map((q, i) => `${i + 1}. ${q.question_text}\n   解説: ${q.explanation}`).join('\n\n');

    return `
あなたは優秀なプロの塾講師・数学アドバイザーです。
中学1年生の生徒が「${storedData.unitTitle}」の演習ドリルを完了しました。

結果: ${score}点（${storedData.totalQuestions}問中 ${correctQuestions.length}問 正解）
所要時間: ${storedData.time}秒

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

  if (saving || !storedData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
        <div className="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full mb-4"></div>
        <p className="text-gray-500 font-medium animate-pulse">演習結果を保存しています...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full border-0 shadow-2xl">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <div className="bg-red-100 p-4 rounded-full">
                <AlertCircle className="w-12 h-12 text-red-600" />
              </div>
            </div>
            <CardTitle className="text-2xl font-black text-gray-900">保存エラー</CardTitle>
            <CardDescription className="text-base mt-2">
              {error}
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col gap-3 pt-6 pb-8 px-8">
            <Button 
              size="lg"
              className="w-full bg-primary hover:bg-primary/90 font-bold"
              onClick={() => {
                setError(null);
                setSaving(true);
                processedRef.current = false;
                processResult();
              }}
            >
              <RefreshCw className="w-5 h-5 mr-2" /> 再試行する
            </Button>
            <Button 
              variant="outline" 
              size="lg"
              className="w-full font-bold"
              onClick={() => router.push('/')}
            >
              ダッシュボードに戻る
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAEB] flex flex-col p-4 md:py-12 md:px-8">
      <div className="max-w-4xl mx-auto w-full space-y-8">

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => router.push('/')} className="hover:bg-white/50 text-muted-foreground hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5 mr-2" /> ダッシュボードに戻る
          </Button>
        </div>

        {/* Score Header */}
        <Card className={`overflow-hidden border-0 shadow-2xl relative ${isHighScore ? 'bg-gradient-to-br from-yellow-50 to-orange-50' : 'bg-white'}`}>
          <div className="absolute top-0 left-0 w-full h-2 bg-primary"></div>
          <CardContent className="p-10 text-center flex flex-col items-center">
            {isHighScore && (
              <div className="mb-6 inline-flex items-center gap-2 bg-yellow-400 text-yellow-900 px-6 py-2 rounded-full text-sm font-extrabold shadow-lg animate-bounce uppercase tracking-wider">
                <Trophy className="w-5 h-5" /> New Record!
              </div>
            )}
            <h2 className="text-xl font-bold text-gray-500 mb-6 uppercase tracking-widest">
              「{storedData.unitTitle}」 Result
            </h2>
            <div className="text-7xl font-black text-primary my-4 flex items-baseline justify-center gap-3">
              {score}
              <span className="text-3xl text-primary/40 font-medium">/ 100</span>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-2 mb-6">
              <p className="text-lg font-mono text-gray-600 bg-black/5 px-6 py-2 rounded-full">
                Time: {Math.floor(storedData.time / 60)}m {storedData.time % 60}s
              </p>
              {xpDetails && xpDetails.finalXp > 0 && (
                <div className="text-left bg-blue-50/80 border border-blue-100/50 px-5 py-2.5 rounded-2xl shadow-sm">
                  <p className="font-extrabold text-blue-700 text-lg flex items-center mb-0.5">
                    <ArrowUpCircle className="w-5 h-5 mr-1.5" strokeWidth={2.5} /> +{xpDetails.finalXp} XP 獲得!
                  </p>
                  <p className="text-[11px] text-blue-600/80 font-mono tracking-tighter">
                    基礎:{xpDetails.base} コンボ:{xpDetails.combo} 正答率ボーナス:x{xpDetails.multiplier}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* AI Advisor Prompt generator */}
        <Card className="shadow-xl border-0 bg-gradient-to-br flex flex-col overflow-hidden from-blue-50 to-indigo-50/50">
          <div className="h-1.5 w-full bg-blue-500"></div>
          <CardHeader className="px-8 pt-8">
            <CardTitle className="flex items-center text-blue-800 text-2xl font-bold">
              <Sparkles className="w-6 h-6 mr-3 text-blue-600" />
              AI学習アドバイザーを活用する
            </CardTitle>
            <CardDescription className="text-base text-blue-700/80 mt-2">
              結果を元に生成されたプロンプトを外部のAIチャット（GeminiやChatGPT等）に貼り付けて、個別アドバイスをもらいましょう。
            </CardDescription>
          </CardHeader>
          <CardContent className="px-8 pb-4">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-200 to-indigo-200 rounded-lg blur opacity-50 group-hover:opacity-100 transition duration-500"></div>
              <div className="relative bg-white/90 backdrop-blur p-6 rounded-xl text-sm text-gray-800 whitespace-pre-wrap font-mono h-40 overflow-y-auto border border-blue-100 shadow-inner">
                {generatePrompt()}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end px-8 pb-8 pt-4">
            <Button
              size="lg"
              onClick={handleCopyPrompt}
              className={`shadow-md transition-all font-bold ${copied ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700 hover:-translate-y-0.5 hover:shadow-lg'}`}
            >
              {copied ? <CheckCircle2 className="w-5 h-5 mr-2" /> : <Copy className="w-5 h-5 mr-2" />}
              {copied ? 'コピーしました！' : 'プロンプトをコピー'}
            </Button>
          </CardFooter>
        </Card>

        {/* Question Review */}
        <div className="space-y-6 pt-8">
          <h3 className="text-2xl font-extrabold text-gray-900 mb-6 flex items-center">
            <span className="bg-gray-200 w-8 h-8 rounded-full inline-flex items-center justify-center mr-3 text-sm">✓</span>
            問題の振り返り
          </h3>

          <div className="grid gap-6">
            {wrongQuestions.length > 0 && (
              <div className="space-y-4">
                <h4 className="font-bold text-destructive flex items-center text-lg bg-red-50 p-3 rounded-lg border border-red-100">
                  <XCircle className="w-6 h-6 mr-2" />
                  間違えた問題 <span className="text-sm font-normal text-destructive/70 ml-2">({wrongQuestions.length}問)</span>
                </h4>
                {wrongQuestions.map((q, i) => (
                  <Card key={`wrong-${i}`} className="border-0 shadow-md overflow-hidden bg-white">
                    <div className="h-1 w-full bg-destructive"></div>
                    <CardHeader className="px-6 py-5 bg-gray-50/50 border-b">
                      <CardTitle className="text-base font-normal leading-relaxed text-gray-900">
                        <MathDisplay math={q.question_text} />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="bg-red-50/30 px-6 py-5">
                      <div className="mb-6 space-y-3">
                        <div className="flex items-start bg-white p-3 rounded-lg border border-red-100 shadow-sm">
                          <span className="inline-block px-2 py-1 text-xs font-bold rounded bg-red-100 text-red-700 mr-3 mt-0.5 whitespace-nowrap">あなたの回答</span>
                          <div className="text-gray-700 overflow-x-auto">
                            <MathDisplay math={q.selectedOptionText} />
                          </div>
                        </div>
                        <div className="flex items-start bg-white p-3 rounded-lg border border-green-100 shadow-sm">
                          <span className="inline-block px-2 py-1 text-xs font-bold rounded bg-green-100 text-green-700 mr-3 mt-0.5 whitespace-nowrap">　正しい解答　</span>
                          <div className="font-bold text-gray-900 overflow-x-auto">
                            <MathDisplay math={q.correctOptionText} />
                          </div>
                        </div>
                      </div>
                      <p className="font-bold text-destructive mb-2 flex items-center text-sm">
                        <span className="bg-destructive/10 px-2 py-0.5 rounded text-destructive mr-2">解説</span>
                      </p>
                      <div className="text-gray-800 leading-relaxed">
                        <MathDisplay math={q.explanation || '解説がありません。'} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {correctQuestions.length > 0 && (
              <div className="space-y-4 mt-8">
                <h4 className="font-bold text-green-700 flex items-center text-lg bg-green-50 p-3 rounded-lg border border-green-100">
                  <CheckCircle2 className="w-6 h-6 mr-2" />
                  正解した問題 <span className="text-sm font-normal text-green-700/70 ml-2">({correctQuestions.length}問)</span>
                </h4>
                {correctQuestions.map((q, i) => (
                  <Card key={`correct-${i}`} className="border-0 shadow-sm overflow-hidden bg-white opacity-90 transition-opacity hover:opacity-100">
                    <div className="h-1 w-full bg-green-400"></div>
                    <CardHeader className="px-6 py-5">
                      <CardTitle className="text-base font-normal leading-relaxed text-gray-700">
                        <MathDisplay math={q.question_text} />
                      </CardTitle>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Level Up Modal */}
        {levelUpData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 w-full h-full backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl scale-in-center">
              <div className="bg-gradient-to-r from-amber-400 to-orange-500 p-6 text-center text-white relative">
                <div className="absolute top-0 left-0 w-full h-full bg-white/20 animate-pulse mix-blend-overlay"></div>
                <h3 className="text-3xl font-black tracking-widest uppercase mb-1 drop-shadow-md">LEVEL UP!</h3>
                <p className="text-orange-100 font-medium tracking-wide">レベルが上がりました</p>
              </div>
              <div className="p-8 text-center bg-[#F8FAEB]">
                <div className="flex justify-center items-center gap-6 mb-8">
                  <div className="text-5xl font-bold text-gray-400">{levelUpData.oldLevel}</div>
                  <div className="text-muted-foreground w-8 h-8 flex items-center justify-center animate-pulse">▶</div>
                  <div className="text-7xl font-black text-amber-500 drop-shadow-sm">{levelUpData.newLevel}</div>
                </div>

                <div className="bg-white p-5 rounded-2xl shadow-sm border border-amber-100">
                  <p className="text-xs text-muted-foreground font-black mb-3 uppercase tracking-wider">New Avatar Unlocked</p>
                  <div className="text-7xl mb-4 filter drop-shadow hover:scale-110 transition-transform">{levelUpData.icon}</div>
                  <p className="text-sm font-medium text-gray-800 leading-relaxed mb-1">
                    新たに「<span className="font-bold text-xl mx-1">{levelUpData.icon}</span>」のアイコンが使えるようになりました！
                  </p>
                  <p className="text-xs text-muted-foreground mt-2 bg-gray-50 p-2 rounded">ダッシュボードでアイコンを変更できます</p>
                </div>

                <Button
                  onClick={() => setLevelUpData(null)}
                  className="w-full mt-6 bg-amber-500 hover:bg-amber-600 font-bold text-lg h-12 shadow-md transition-transform hover:-translate-y-0.5"
                >
                  確認
                </Button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
