'use client';

import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, BookOpen, RefreshCw, Send, ShieldCheck, Square, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MathDisplay } from '@/components/MathDisplay';
import {
  ADVISOR_RESPONSE_SCHEMA,
  COMPACT_ADVISOR_RESPONSE_SCHEMA,
  COMPACT_PRACTICE_RESPONSE_SCHEMA,
  FOLLOW_UP_RESPONSE_SCHEMA,
  PRACTICE_RESPONSE_SCHEMA,
  buildAdvisorPrompt,
  buildCompactAdvisorPrompt,
  buildCompactPracticePrompt,
  buildFollowUpPrompt,
  buildPracticePrompt,
  createOnDeviceAiSession,
  getOnDeviceAiErrorMessage,
  groundAdvisorResult,
  isOnDeviceAiResponseFormatError,
  normalizeOnDeviceAiMathText,
  parseAdvisorResult,
  parseFollowUpResult,
  parsePracticeResult,
  toPlainOnDeviceAiMathText,
  type AdvisorCorrectQuestion,
  type AdvisorResult,
  type AdvisorWrongQuestion,
  type OnDeviceAiSession,
  type PracticeProblem,
} from '@/lib/onDeviceAiAdvisor';

type Props = {
  unitTitle: string;
  score: number;
  totalQuestions: number;
  correctQuestions: AdvisorCorrectQuestion[];
  wrongQuestions: AdvisorWrongQuestion[];
};

type QuestionAnswer = {
  id: string;
  problemTitle: string;
  question: string;
  answer: string;
  nextStep: string;
};

function AiMathText({ text, className }: { text: string; className: string }) {
  return <MathDisplay math={normalizeOnDeviceAiMathText(text)} className={className} />;
}

export function OnDeviceAiAdvisor({
  unitTitle,
  score,
  totalQuestions,
  correctQuestions,
  wrongQuestions,
}: Props) {
  const [advice, setAdvice] = useState<AdvisorResult | null>(null);
  const [practiceProblems, setPracticeProblems] = useState<PracticeProblem[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState('');
  const [learnerQuestion, setLearnerQuestion] = useState('');
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);
  const [busyAction, setBusyAction] = useState<'advice' | 'question' | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const sessionRef = useRef<OnDeviceAiSession | null>(null);
  const followUpSessionRef = useRef<OnDeviceAiSession | null>(null);
  const followUpQuestionIdRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    followUpSessionRef.current?.destroy();
    sessionRef.current?.destroy();
    followUpSessionRef.current = null;
    sessionRef.current = null;
  }, []);

  const getSession = async (controller: AbortController) => {
    if (sessionRef.current) return sessionRef.current;
    setStatusText('この端末のAIを確認しています…');
    const created = await createOnDeviceAiSession(controller.signal, (progress) => {
      setDownloadProgress(progress);
      setStatusText(`AIモデルを準備しています… ${progress}%`);
    });
    sessionRef.current = created.session;
    setStatusText(created.availability === 'available'
      ? 'アドバイスを考えています…'
      : 'AIモデルの準備が完了しました。');
    return created.session;
  };

  const createIsolatedSession = async (
    baseSession: OnDeviceAiSession,
    controller: AbortController,
    forceFresh = false,
  ) => {
    if (baseSession.clone) {
      return {
        session: await baseSession.clone({ signal: controller.signal }),
        shouldDestroy: true,
      };
    }
    if (!forceFresh) return { session: baseSession, shouldDestroy: false };
    const created = await createOnDeviceAiSession(controller.signal, () => undefined);
    return { session: created.session, shouldDestroy: true };
  };

  const getFollowUpSession = async (
    baseSession: OnDeviceAiSession,
    questionId: string,
    controller: AbortController,
  ) => {
    if (followUpSessionRef.current && followUpQuestionIdRef.current === questionId) {
      return followUpSessionRef.current;
    }
    followUpSessionRef.current?.destroy();
    followUpSessionRef.current = baseSession.clone
      ? await baseSession.clone({ signal: controller.signal })
      : (await createOnDeviceAiSession(controller.signal, () => undefined)).session;
    followUpQuestionIdRef.current = questionId;
    return followUpSessionRef.current;
  };

  const resetSessionsAfterError = () => {
    // A rejected prompt can leave a session unusable (quota/context/model errors).
    // Reset on every failure so the next explicit retry starts from clean context.
    followUpSessionRef.current?.destroy();
    sessionRef.current?.destroy();
    followUpSessionRef.current = null;
    sessionRef.current = null;
    followUpQuestionIdRef.current = '';
  };

  const finishWithError = (generationError: unknown) => {
    const message = getOnDeviceAiErrorMessage(generationError);
    if (message) setError(message);
    resetSessionsAfterError();
  };

  const handleGenerateAdvice = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusyAction('advice');
    setDownloadProgress(0);
    setError('');
    setPracticeProblems([]);
    let adviceGenerated = false;
    try {
      const baseSession = await getSession(controller);
      setStatusText('演習結果を分析しています…');
      const input = {
        unitTitle,
        score,
        totalQuestions,
        correctQuestions,
        wrongQuestions,
      };
      let advisorResult: AdvisorResult;
      try {
        const advisorTask = await createIsolatedSession(baseSession, controller, true);
        try {
          const response = await advisorTask.session.prompt(buildAdvisorPrompt(input), {
            responseConstraint: ADVISOR_RESPONSE_SCHEMA,
            omitResponseConstraintInput: true,
            signal: controller.signal,
          });
          advisorResult = parseAdvisorResult(response);
        } finally {
          if (advisorTask.shouldDestroy) advisorTask.session.destroy();
        }
      } catch (generationError) {
        if (!isOnDeviceAiResponseFormatError(generationError)) throw generationError;
        console.warn('[on-device-ai] Advisor response was incomplete; retrying compact output.');
        setStatusText('回答を短い形式で再生成しています…');
        const retryTask = await createIsolatedSession(baseSession, controller, true);
        try {
          const response = await retryTask.session.prompt(buildCompactAdvisorPrompt(input), {
            responseConstraint: COMPACT_ADVISOR_RESPONSE_SCHEMA,
            omitResponseConstraintInput: true,
            signal: controller.signal,
          });
          advisorResult = parseAdvisorResult(response);
        } finally {
          if (retryTask.shouldDestroy) retryTask.session.destroy();
        }
      }
      advisorResult = groundAdvisorResult(advisorResult, input);
      setAdvice(advisorResult);
      adviceGenerated = true;

      setStatusText('間違いに合わせた練習問題を作っています…');
      let generatedPracticeProblems: PracticeProblem[];
      try {
        const practiceTask = await createIsolatedSession(baseSession, controller, true);
        try {
          const response = await practiceTask.session.prompt(buildPracticePrompt(input), {
            responseConstraint: PRACTICE_RESPONSE_SCHEMA,
            omitResponseConstraintInput: true,
            signal: controller.signal,
          });
          generatedPracticeProblems = parsePracticeResult(response).practiceProblems;
        } finally {
          if (practiceTask.shouldDestroy) practiceTask.session.destroy();
        }
      } catch (generationError) {
        if (!isOnDeviceAiResponseFormatError(generationError)) throw generationError;
        console.warn('[on-device-ai] Practice response was incomplete; retrying compact output.');
        setStatusText('練習問題を短い形式で再生成しています…');
        const retryTask = await createIsolatedSession(baseSession, controller, true);
        try {
          const response = await retryTask.session.prompt(buildCompactPracticePrompt(input), {
            responseConstraint: COMPACT_PRACTICE_RESPONSE_SCHEMA,
            omitResponseConstraintInput: true,
            signal: controller.signal,
          });
          generatedPracticeProblems = parsePracticeResult(response).practiceProblems;
        } finally {
          if (retryTask.shouldDestroy) retryTask.session.destroy();
        }
      }
      setPracticeProblems(generatedPracticeProblems);
      setStatusText('');
    } catch (generationError) {
      const message = getOnDeviceAiErrorMessage(generationError);
      if (message && adviceGenerated) {
        setError(`アドバイスは生成できましたが、類題を生成できませんでした。${message}`);
        resetSessionsAfterError();
      } else {
        finishWithError(generationError);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusyAction(null);
    }
  };

  const selectedQuestion = wrongQuestions.find((question) => (
    question.id === (selectedQuestionId || wrongQuestions[0]?.id)
  ));

  const handleAskQuestion = async () => {
    const questionText = learnerQuestion.trim();
    if (!selectedQuestion || !questionText) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setBusyAction('question');
    setError('');
    try {
      const baseSession = await getSession(controller);
      const session = await getFollowUpSession(baseSession, selectedQuestion.id, controller);
      setStatusText('質問への説明を考えています…');
      const response = await session.prompt(buildFollowUpPrompt(selectedQuestion, questionText), {
        responseConstraint: FOLLOW_UP_RESPONSE_SCHEMA,
        omitResponseConstraintInput: true,
        signal: controller.signal,
      });
      const result = parseFollowUpResult(response);
      setAnswers((current) => [{
        id: `${selectedQuestion.id}:${Date.now()}`,
        problemTitle: selectedQuestion.questionText,
        question: questionText,
        answer: result.answer,
        nextStep: result.nextStep,
      }, ...current].slice(0, 5));
      setLearnerQuestion('');
      setStatusText('');
    } catch (generationError) {
      finishWithError(generationError);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusyAction(null);
    }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    setStatusText('生成を中止しました。');
  };

  return (
    <Card className="overflow-hidden border-0 bg-gradient-to-br from-blue-50 to-indigo-50/50 shadow-xl dark:from-card dark:to-card">
      <div className="h-1.5 w-full bg-blue-500" />
      <CardHeader className="px-6 pt-7 md:px-8 md:pt-8">
        <CardTitle className="flex items-center text-2xl font-bold text-blue-800 dark:text-blue-300">
          <BrainCircuit className="mr-3 h-6 w-6 text-blue-600" />
          この端末のAIで復習する
        </CardTitle>
        <CardDescription className="mt-2 text-sm leading-6 text-blue-700/80 dark:text-blue-200/80">
          Chrome内蔵AIが演習結果を端末内だけで分析します。生成内容は復習用で、採点・成績・XPには影響しません。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 px-6 pb-8 md:px-8">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-100 bg-white/80 p-4">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
          <p className="min-w-52 flex-1 text-xs leading-5 text-gray-600">
            問題と演習結果はクラウドAIへ送信されません。AIの説明には誤りがあり得るため、元の解説も確認してください。
          </p>
          <Button type="button" onClick={handleGenerateAdvice} disabled={busyAction !== null}>
            {advice ? <RefreshCw className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {advice ? 'もう一度生成' : 'この端末でAIアドバイスを生成'}
          </Button>
          {busyAction && (
            <Button type="button" variant="outline" onClick={stopGeneration}>
              <Square className="mr-2 h-3.5 w-3.5 fill-current" />中止
            </Button>
          )}
        </div>

        {busyAction && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4" role="status" aria-live="polite">
            <p className="text-sm font-bold text-blue-800">{statusText || '生成しています…'}</p>
            {downloadProgress > 0 && downloadProgress < 100 && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
                <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${downloadProgress}%` }} />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium leading-6 text-amber-900" role="alert">
            {error}
          </div>
        )}

        {advice && (
          <div className="space-y-5" aria-live="polite">
            <section className="rounded-xl border border-blue-100 bg-white p-5">
              <h3 className="font-black text-blue-950">今回のまとめ</h3>
              <div className="mt-2 whitespace-pre-wrap">
                <AiMathText className="text-sm leading-7 text-gray-700" text={advice.summary} />
              </div>
            </section>
            <div className="grid gap-4 md:grid-cols-3">
              {[
                ['強み', advice.strengths],
                ['重点ポイント', advice.weaknesses],
              ].map(([title, findings]) => (
                <section key={title as string} className="rounded-xl border border-blue-100 bg-white p-5">
                  <h3 className="font-black text-blue-950">{title as string}</h3>
                  <ol className="mt-3 space-y-3 text-sm leading-6 text-gray-700">
                    {(findings as AdvisorResult['strengths']).map((finding, index) => (
                      <li key={`${title}:${index}`}>
                        <div>
                          <span>{index + 1}. </span>
                          <AiMathText className="text-sm leading-6 text-gray-700" text={finding.point} />
                        </div>
                        <div className="mt-1 text-xs leading-5 text-gray-500">
                          <span>根拠: </span>
                          <AiMathText className="text-xs leading-5 text-gray-500" text={finding.evidence} />
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
              <section className="rounded-xl border border-blue-100 bg-white p-5">
                <h3 className="font-black text-blue-950">復習ステップ</h3>
                <ol className="mt-3 space-y-2 text-sm leading-6 text-gray-700">
                  {advice.reviewSteps.map((item, index) => (
                    <li key={`review:${index}`}>
                      <span>{index + 1}. </span>
                      <AiMathText className="text-sm leading-6 text-gray-700" text={item} />
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            {practiceProblems.length > 0 && (
              <section className="rounded-xl border border-indigo-100 bg-white p-5">
                <h3 className="flex items-center font-black text-indigo-950">
                  <BookOpen className="mr-2 h-5 w-5" />AIが作った練習問題
                </h3>
                <p className="mt-1 text-xs text-gray-500">練習専用です。スコアやXPには反映されません。</p>
                <div className="mt-4 space-y-4">
                  {practiceProblems.map((problem, index) => (
                    <article key={`${problem.question}:${index}`} className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
                      <div className="whitespace-pre-wrap text-sm font-bold leading-7 text-gray-900">
                        <span>問題{index + 1}: </span>
                        <AiMathText className="text-sm font-bold leading-7 text-gray-900" text={problem.question} />
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-xs leading-6 text-indigo-800">
                        <span>ヒント: </span>
                        <AiMathText className="text-xs leading-6 text-indigo-800" text={problem.hint} />
                      </div>
                      <details className="mt-3 rounded-lg bg-white p-3">
                        <summary className="cursor-pointer text-sm font-bold text-indigo-700">答えと解説を見る</summary>
                        <div className="mt-3 whitespace-pre-wrap text-sm font-bold text-gray-900">
                          <span>答え: </span>
                          <AiMathText className="text-sm font-bold text-gray-900" text={problem.answer} />
                        </div>
                        <div className="mt-2 whitespace-pre-wrap">
                          <AiMathText className="text-sm leading-7 text-gray-700" text={problem.explanation} />
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-xs leading-6 text-emerald-700">
                          <span>答えの確認: </span>
                          <AiMathText className="text-xs leading-6 text-emerald-700" text={problem.verification} />
                        </div>
                      </details>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {advice && wrongQuestions.length > 0 && (
          <section className="rounded-xl border border-blue-100 bg-white p-5">
            <h3 className="flex items-center font-black text-blue-950">
              <Send className="mr-2 h-4 w-4" />間違えた問題を質問する
            </h3>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-bold text-gray-600" htmlFor="ai-advisor-problem">質問する問題</label>
              <select
                id="ai-advisor-problem"
                value={selectedQuestionId || wrongQuestions[0]?.id}
                onChange={(event) => setSelectedQuestionId(event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                {wrongQuestions.map((question, index) => (
                  <option key={question.id} value={question.id}>
                    問題{index + 1}: {toPlainOnDeviceAiMathText(question.questionText).slice(0, 80)}
                  </option>
                ))}
              </select>
              <label className="block text-xs font-bold text-gray-600" htmlFor="ai-advisor-question">追加の質問</label>
              <textarea
                id="ai-advisor-question"
                value={learnerQuestion}
                onChange={(event) => setLearnerQuestion(event.target.value.slice(0, 500))}
                rows={3}
                placeholder="例: どうしてこの式になるの？ 別の考え方でも解ける？"
                className="w-full resize-none rounded-lg border border-gray-200 bg-white p-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              <div className="flex justify-end">
                <Button type="button" onClick={handleAskQuestion} disabled={!learnerQuestion.trim() || busyAction !== null}>
                  <Send className="mr-2 h-4 w-4" />質問する
                </Button>
              </div>
            </div>
            {answers.length > 0 && (
              <div className="mt-5 space-y-4" aria-live="polite">
                {answers.map((item) => (
                  <article key={item.id} className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
                    <div className="truncate text-xs font-bold text-blue-700" title={toPlainOnDeviceAiMathText(item.problemTitle)}>
                      <AiMathText className="text-xs font-bold text-blue-700" text={item.problemTitle} />
                    </div>
                    <div className="mt-2 text-sm font-bold text-gray-900">
                      <span>Q. </span>
                      <AiMathText className="text-sm font-bold text-gray-900" text={item.question} />
                    </div>
                    <div className="mt-3 whitespace-pre-wrap">
                      <AiMathText className="text-sm leading-7 text-gray-700" text={item.answer} />
                    </div>
                    {item.nextStep && (
                      <div className="mt-3 text-xs font-bold leading-6 text-emerald-700">
                        <span>次に確認: </span>
                        <AiMathText className="text-xs font-bold leading-6 text-emerald-700" text={item.nextStep} />
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
