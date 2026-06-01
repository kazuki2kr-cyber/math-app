'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { MathDisplay } from '@/components/MathDisplay';
const fireConfetti = (opts: object) => import('canvas-confetti').then(m => m.default(opts));
import { Copy, ArrowLeft, Trophy, Sparkles, CheckCircle2, XCircle, ArrowUpCircle, AlertCircle, RefreshCw, MessageSquare, Send } from 'lucide-react';
import { getAvailableIcons, getTitleForLevel } from '@/lib/xp';

// sessionStorage 縺ｫ菫晏ｭ倥＆繧後※縺・ｋ貍皮ｿ偵ョ繝ｼ繧ｿ・医け繝ｩ繧､繧｢繝ｳ繝医・豁｣隱､諠・ｱ繧呈戟縺溘↑縺・ｼ・
interface StoredDrillData {
  type?: 'multiple_choice' | 'written';
  attemptId?: string;
  unitId: string;
  unitTitle: string;
  totalQuestions: number;
  mode?: 'standard' | 'wrong' | 'all';
  time: number;
  answers?: Array<{ questionId: string; selectedOptionText: string }>;
  questionId?: string;
  questionText?: string;
  answerImageDataUrl?: string;
}

// 繧ｵ繝ｼ繝舌・縺九ｉ霑斐▲縺ｦ縺上ｋ豁｣隗｣蝠城｡・
interface CorrectQuestion {
  id: string;
  question_text: string;
}

// 繧ｵ繝ｼ繝舌・縺九ｉ霑斐▲縺ｦ縺上ｋ荳肴ｭ｣隗｣蝠城｡・
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

interface WrittenGrading {
  score: number;
  detectedAnswer: string;
  feedback: string;
  improvementPoints: string[];
  rubricScores: Array<{ label: string; score: number; maxScore: number; comment: string }>;
}

const WRITTEN_FEEDBACK_OPTIONS = {
  rating: [
    { value: 'helpful', label: '役に立った' },
    { value: 'partly_helpful', label: '少し役に立った' },
    { value: 'not_helpful', label: '役に立たなかった' },
  ],
  strictness: [
    { value: 'appropriate', label: 'ちょうどよい' },
    { value: 'too_lenient', label: '甘い' },
    { value: 'too_strict', label: '厳しい' },
    { value: 'unsure', label: 'わからない' },
  ],
  usefulness: [
    { value: 'very_useful', label: '改善しやすい' },
    { value: 'somewhat_useful', label: '一部参考になる' },
    { value: 'not_useful', label: '参考になりにくい' },
  ],
  clarity: [
    { value: 'clear', label: 'わかりやすい' },
    { value: 'somewhat_unclear', label: '少しわかりにくい' },
    { value: 'unclear', label: 'わかりにくい' },
  ],
} as const;

function normalizeMathFeedbackText(text: string) {
  if (!text) return text;

  const normalized = text
    .replace(/\u000crac/g, '\\frac')
    .replace(/\u000crt/g, '\\sqrt')
    .replace(/\u000c/g, '\\f');

  if (/(\$\$[\s\S]*\$\$|\\\[[\s\S]*\\\]|\\\([\s\S]*\\\)|\$[\s\S]*\$)/.test(normalized)) return normalized;

  const withLatexCommands = normalized
    .replace(/\\frac\{[^{}]+\}\{[^{}]+\}/g, (match) => `\\(${match}\\)`)
    .replace(/\\sqrt\{[^{}]+\}/g, (match) => `\\(${match}\\)`);

  return withLatexCommands.replace(
    /((?:[0-9a-zA-Z\u03c0]+|[+\-\u2212\u00d7\u00f7=*/^().,]|\s){3,}(?:=|\u00d7|\u00f7|\+|\-|\^)(?:[0-9a-zA-Z\u03c0]+|[+\-\u2212\u00d7\u00f7=*/^().,]|\s){2,})/g,
    (match) => {
      const trimmed = match.trim();
      if (!trimmed || !/[0-9a-zA-Z\u03c0]/.test(trimmed)) return match;
      const leading = match.match(/^\s*/)?.[0] || '';
      const trailing = match.match(/\s*$/)?.[0] || '';
      const latex = trimmed
        .replace(/\u03c0/g, '\\pi')
        .replace(/\u00d7/g, '\\times')
        .replace(/\u00f7/g, '\\div')
        .replace(/\u2212/g, '-');
      return `${leading}\\(${latex}\\)${trailing}`;
    }
  );
}

function FeedbackMath({ children, className }: { children: string; className?: string }) {
  return <MathDisplay math={normalizeMathFeedbackText(children)} className={className || 'text-base'} />;
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
  const [writtenGrading, setWrittenGrading] = useState<WrittenGrading | null>(null);
  const [writtenModelAnswer, setWrittenModelAnswer] = useState('');
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [writtenFeedbackOpen, setWrittenFeedbackOpen] = useState(false);
  const [writtenFeedback, setWrittenFeedback] = useState({
    rating: 'helpful',
    strictness: 'appropriate',
    usefulness: 'very_useful',
    clarity: 'clear',
    message: '',
  });
  const [writtenFeedbackSubmitting, setWrittenFeedbackSubmitting] = useState(false);
  const [writtenFeedbackSent, setWrittenFeedbackSent] = useState(false);
  const [writtenFeedbackStatus, setWrittenFeedbackStatus] = useState('');

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

    // 譌ｧ蠖｢蠑擾ｼ・nswers 繝輔ぅ繝ｼ繝ｫ繝峨↑縺暦ｼ峨・繝・・繧ｿ縺梧ｮ九▲縺ｦ縺・◆蝣ｴ蜷医・遐ｴ譽・＠縺ｦ繝繝・す繝･繝懊・繝峨∈
    if (parsed.type === 'written') {
      if (!parsed.questionId || !parsed.answerImageDataUrl) {
        sessionStorage.removeItem('drillResult');
        router.push('/');
        return;
      }
    } else if (!Array.isArray(parsed.answers)) {
      sessionStorage.removeItem('drillResult');
      router.push('/');
      return;
    }

    setStoredData(parsed);
    setError(null);
    setSaving(true);

    // 騾｣謇馴亟豁｢・・essionStorage 縺ｯ繝ｪ繝ｭ繝ｼ繝牙ｯｾ蠢懊・縺溘ａ谿九☆・・
    if (processedRef.current) return;
    processedRef.current = true;

    try {
      const functions = getFunctions(undefined, 'us-central1');
      const process = httpsCallable(functions, parsed.type === 'written' ? 'submitWrittenDrillResult' : 'processDrillResult');

      // 15遘偵・繧ｿ繧､繝繧｢繧ｦ繝亥・逅・
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), parsed.type === 'written' ? 120000 : 15000)
      );

      const resultResponse = await Promise.race([
        parsed.type === 'written'
          ? process({
              attemptId: parsed.attemptId,
              unitId,
              questionId: parsed.questionId,
              time: parsed.time,
              answerImageDataUrl: parsed.answerImageDataUrl,
            })
          : process({
              attemptId: parsed.attemptId,
              unitId,
              unitTitle: parsed.unitTitle,
              mode: parsed.mode || 'standard',
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
        xpGain?: number;
        grading?: WrittenGrading;
        remainingAttempts?: number;
        modelAnswer?: string;
      };

      if (data.success) {
        setScore(data.score);
        setXpDetails(data.xpDetails || (data.xpGain !== undefined ? {
          base: data.xpGain,
          combo: 0,
          multiplier: data.score / 100,
          multiplierBonus: 0,
          finalXp: data.xpGain,
        } : null));
        setCorrectQuestions(data.correctQuestions || []);
        setWrongQuestions(data.wrongQuestions || []);
        setWrittenGrading(data.grading || null);
        setWrittenModelAnswer(data.modelAnswer || '');
        setRemainingAttempts(data.remainingAttempts ?? null);
        if (parsed.type === 'written') {
          sessionStorage.removeItem('drillResult');
        }

        if (data.isHighScore) {
          setIsHighScore(true);
          if (!data.isLevelUp) {
            fireConfetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#22c55e', '#3b82f6', '#eab308'] });
          }
        }

        if (data.isLevelUp) {
          const newIcons = getAvailableIcons(data.newLevel);
          const newlyUnlockedIcon = newIcons[newIcons.length - 1] || '雌';
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
      processedRef.current = false; // 蜀崎ｩｦ陦後ｒ蜿ｯ閭ｽ縺ｫ縺吶ｋ
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
${correctList || 'なし'}

【不正解だった問題】
${wrongList || 'なし'}

上記のデータから、以下の3点を出力してください。
1. この生徒の「強み」と「弱み」の具体的な分析
2. 弱点を克服するためのアドバイスを3点
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

  const handleSubmitWrittenFeedback = async () => {
    if (!storedData || !writtenGrading || !storedData.attemptId || !storedData.questionId || writtenFeedbackSubmitting || writtenFeedbackSent) return;

    setWrittenFeedbackSubmitting(true);
    setWrittenFeedbackStatus('');
    try {
      const functions = getFunctions(undefined, 'us-central1');
      const submit = httpsCallable(functions, 'submitWrittenGradingFeedback');
      await submit({
        unitId,
        unitTitle: storedData.unitTitle,
        questionId: storedData.questionId,
        questionText: storedData.questionText || '',
        attemptId: storedData.attemptId,
        score,
        rating: writtenFeedback.rating,
        strictness: writtenFeedback.strictness,
        usefulness: writtenFeedback.usefulness,
        clarity: writtenFeedback.clarity,
        message: writtenFeedback.message,
        rubricScores: writtenGrading.rubricScores.map(item => ({
          label: item.label,
          score: item.score,
          maxScore: item.maxScore,
        })),
      });
      setWrittenFeedbackSent(true);
      setWrittenFeedbackStatus('送信しました。採点基準の改善に活用します。');
    } catch (err) {
      console.error('Failed to submit written grading feedback:', err);
      setWrittenFeedbackStatus('送信に失敗しました。時間をおいてもう一度お試しください。');
    } finally {
      setWrittenFeedbackSubmitting(false);
    }
  };

  if (saving || !storedData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
        <div className="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full mb-4"></div>
        <p className="text-gray-500 font-medium animate-pulse">
          演習結果を保存しています...
        </p>
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
              {storedData.unitTitle} Result
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
                    <ArrowUpCircle className="w-5 h-5 mr-1.5" strokeWidth={2.5} /> +{xpDetails.finalXp} XP 獲得
                  </p>
                  <p className="text-[11px] text-blue-600/80 font-mono tracking-tighter">
                    基礎:{xpDetails.base} コンボ:{xpDetails.combo} 正答率ボーナス:x{xpDetails.multiplier}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {storedData.type === 'written' && writtenGrading && (
          <Card className="shadow-xl border-0 bg-white overflow-hidden">
            <div className="h-1.5 w-full bg-primary"></div>
            <CardHeader className="px-8 pt-8">
              <CardTitle className="text-2xl font-bold text-gray-900">記述式フィードバック</CardTitle>
              <CardDescription>
                このスコアは総合ランキング用の合計スコアには含まれません。XPのみ得点に応じて反映されます。
                {remainingAttempts !== null && <span className="ml-2 font-bold text-primary">残り提出回数: {remainingAttempts}</span>}
              </CardDescription>
              <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="flex items-center gap-2 text-base font-black text-blue-950">
                      <MessageSquare className="h-5 w-5 text-blue-700" />
                      採点の感想を送ってください
                    </p>
                    <p className="mt-1 text-sm font-medium leading-relaxed text-blue-800">
                      記述式イベントは、みんなの声をもとに採点基準を調整していきます。点が甘い・厳しい・説明が分かりにくいなど、気づいたことがあれば気軽に送ってください。
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="lg"
                    onClick={() => setWrittenFeedbackOpen(true)}
                    disabled={writtenFeedbackSent}
                    className="shrink-0 bg-blue-700 px-6 font-black hover:bg-blue-800"
                  >
                    <Send className="mr-2 h-5 w-5" />
                    {writtenFeedbackSent ? '送信済み' : '採点フィードバックを送る'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-8 pb-8 space-y-6">
              {storedData.answerImageDataUrl && (
                <div className="rounded-xl border bg-white p-4">
                  <p className="text-xs font-bold text-muted-foreground mb-3">提出した解答画像</p>
                  <img
                    src={storedData.answerImageDataUrl}
                    alt="提出した記述式解答"
                    className="max-h-[520px] w-full object-contain rounded-lg border bg-white"
                  />
                </div>
              )}

              {writtenGrading.detectedAnswer && (
                <div className="rounded-xl border bg-gray-50 p-4">
                  <p className="text-xs font-bold text-muted-foreground mb-2">読み取った答え</p>
                  <MathDisplay math={writtenGrading.detectedAnswer} />
                </div>
              )}

              {writtenModelAnswer && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-5">
                  <p className="text-sm font-bold text-emerald-800 mb-3">模範解答</p>
                  <div className="text-gray-900 leading-relaxed">
                    <FeedbackMath>{writtenModelAnswer}</FeedbackMath>
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {writtenGrading.rubricScores.map((item, index) => (
                  <div key={`${item.label}-${index}`} className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="font-bold text-gray-900">{item.label}</p>
                      <p className="font-mono text-primary font-black">{item.score}/{item.maxScore}</p>
                    </div>
                    <div className="text-sm text-gray-600 leading-relaxed">
                      <FeedbackMath className="text-sm">{item.comment}</FeedbackMath>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-primary/10 bg-primary/5 p-5">
                <p className="text-sm font-bold text-primary mb-2">総評</p>
                <div className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                  <FeedbackMath>{writtenGrading.feedback}</FeedbackMath>
                </div>
              </div>

              {writtenGrading.improvementPoints.length > 0 && (
                <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-5">
                  <p className="text-sm font-bold text-amber-800 mb-3">改善ポイント</p>
                  <ul className="space-y-2">
                    {writtenGrading.improvementPoints.map((point, index) => (
                      <li key={index} className="text-sm text-amber-900 leading-relaxed">
                        <span className="mr-1">・</span>
                        <FeedbackMath className="text-sm">{point}</FeedbackMath>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold text-blue-900">
                      <MessageSquare className="h-4 w-4" />
                      この採点へのフィードバック
                    </p>
                    <p className="mt-1 text-xs text-blue-700/80">
                      送信内容は記述式イベントの採点基準改善用に、通常のアプリ全体フィードバックとは別に保存されます。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={writtenFeedbackOpen ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setWrittenFeedbackOpen(prev => !prev)}
                    disabled={writtenFeedbackSent}
                  >
                    {writtenFeedbackSent ? '送信済み' : writtenFeedbackOpen ? '閉じる' : '送る'}
                  </Button>
                </div>

                {writtenFeedbackOpen && !writtenFeedbackSent && (
                  <div className="mt-5 space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {([
                        ['rating', '総合評価'],
                        ['strictness', '採点の厳しさ'],
                        ['usefulness', '改善点の参考度'],
                        ['clarity', '説明のわかりやすさ'],
                      ] as const).map(([key, label]) => (
                        <div key={key} className="space-y-2">
                          <p className="text-xs font-bold text-blue-900">{label}</p>
                          <div className="flex flex-wrap gap-2">
                            {WRITTEN_FEEDBACK_OPTIONS[key].map(option => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setWrittenFeedback(prev => ({ ...prev, [key]: option.value }))}
                                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                                  writtenFeedback[key] === option.value
                                    ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                                    : 'border-blue-100 bg-white text-blue-800 hover:bg-blue-50'
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-blue-900" htmlFor="written-feedback-message">
                        コメント（任意）
                      </label>
                      <textarea
                        id="written-feedback-message"
                        value={writtenFeedback.message}
                        onChange={(event) => setWrittenFeedback(prev => ({ ...prev, message: event.target.value.slice(0, 1000) }))}
                        placeholder="例: 答えが違うのに点が高い / 変数定義の減点がもっと必要 / 改善点がわかりやすかった など"
                        className="min-h-24 w-full resize-none rounded-xl border border-blue-100 bg-white p-3 text-sm outline-none ring-blue-200 transition focus:ring-2"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] text-blue-700/70">{writtenFeedback.message.length}/1000</p>
                        <Button
                          type="button"
                          onClick={handleSubmitWrittenFeedback}
                          disabled={writtenFeedbackSubmitting}
                          className="font-bold"
                        >
                          <Send className="mr-2 h-4 w-4" />
                          {writtenFeedbackSubmitting ? '送信中...' : 'フィードバックを送信'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {writtenFeedbackStatus && (
                  <p className={`mt-3 text-xs font-bold ${writtenFeedbackSent ? 'text-blue-800' : 'text-red-600'}`}>
                    {writtenFeedbackStatus}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI Advisor Prompt generator */}
        {storedData.type !== 'written' && (
        <Card className="shadow-xl border-0 bg-gradient-to-br flex flex-col overflow-hidden from-blue-50 to-indigo-50/50">
          <div className="h-1.5 w-full bg-blue-500"></div>
          <CardHeader className="px-8 pt-8">
            <CardTitle className="flex items-center text-blue-800 text-2xl font-bold">
              <Sparkles className="w-6 h-6 mr-3 text-blue-600" />
              AI学習アドバイザーを活用する
            </CardTitle>
            <CardDescription className="text-base text-blue-700/80 mt-2">
              結果をもとに生成されたプロンプトを外部のAIチャットに貼り付けて、個別アドバイスをもらえます。
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
              {copied ? 'コピーしました' : 'プロンプトをコピー'}
            </Button>
          </CardFooter>
        </Card>
        )}

        {/* Question Review */}
        {storedData.type !== 'written' && (
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
                  間違えた問題<span className="text-sm font-normal text-destructive/70 ml-2">({wrongQuestions.length}問)</span>
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
                          <span className="inline-block px-2 py-1 text-xs font-bold rounded bg-green-100 text-green-700 mr-3 mt-0.5 whitespace-nowrap">正しい答え</span>
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
                  正解した問題<span className="text-sm font-normal text-green-700/70 ml-2">({correctQuestions.length}問)</span>
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
        )}

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
                  <div className="text-muted-foreground w-8 h-8 flex items-center justify-center animate-pulse">笆ｶ</div>
                  <div className="text-7xl font-black text-amber-500 drop-shadow-sm">{levelUpData.newLevel}</div>
                </div>

                <div className="bg-white p-5 rounded-2xl shadow-sm border border-amber-100">
                  <p className="text-xs text-muted-foreground font-black mb-3 uppercase tracking-wider">New Avatar Unlocked</p>
                  <div className="text-7xl mb-4 filter drop-shadow hover:scale-110 transition-transform">{levelUpData.icon}</div>
                  <p className="text-sm font-medium text-gray-800 leading-relaxed mb-1">
                    新たに<span className="font-bold text-xl mx-1">{levelUpData.icon}</span>のアイコンが使えるようになりました。
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
