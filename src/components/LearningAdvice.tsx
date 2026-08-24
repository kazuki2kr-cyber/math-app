'use client';

import { useState } from 'react';
import { BrainCircuit, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LearningProgressReport } from '@/lib/learningProgress';

interface LearningAdviceProps {
  report: LearningProgressReport;
}

interface AdviceResult {
  summary: string;
  encouragement: string;
  studyTips: string[];
}

const MODEL_OPTIONS: LanguageModelCreateOptions = {
  expectedInputs: [{ type: 'text', languages: ['ja'] }],
  expectedOutputs: [{ type: 'text', languages: ['ja'] }],
  initialPrompts: [{
    role: 'system',
    content: 'あなたは中学生の数学学習を支える先生です。数値を誇張せず、短く具体的で前向きな日本語を使ってください。入力にない成績や単元を作らないでください。',
  }],
};

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    encouragement: { type: 'string' },
    studyTips: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string' },
    },
  },
  required: ['summary', 'encouragement', 'studyTips'],
  additionalProperties: false,
};

function buildAdvicePrompt(report: LearningProgressReport): string {
  const input = {
    overall: {
      trackedAttempts: report.overall.trackedAttempts,
      answeredCount: report.overall.answeredCount,
      accuracy: report.overall.accuracy,
      studyTimeMinutes: Math.round(report.overall.studyTimeSec / 60),
      masteredUnits: report.overall.masteredUnits,
      totalUnits: report.overall.totalUnits,
    },
    recommendedUnits: report.recommendations.map((unit) => ({
      title: unit.title,
      category: unit.category,
      status: unit.statusLabel,
      accuracy: unit.accuracy,
      wrongCount: unit.wrongCount,
      reason: unit.recommendationReason,
    })),
  };

  return `次の匿名化済み学習集計だけを使い、振り返りを1つ、励ましを1つ、具体的な学習のコツを1〜3個作ってください。\n${JSON.stringify(input)}`;
}

export function LearningAdvice({ report }: LearningAdviceProps) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'downloading' | 'generating' | 'done' | 'error'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [advice, setAdvice] = useState<AdviceResult | null>(null);
  const [message, setMessage] = useState('');

  const generateAdvice = async () => {
    setAdvice(null);
    setMessage('');
    setDownloadProgress(0);
    setStatus('checking');

    if (typeof LanguageModel === 'undefined') {
      setMessage('この端末では端末内AIを利用できません。上の「次におすすめ」を参考にしてください。');
      setStatus('error');
      return;
    }

    let session: LanguageModelSession | null = null;
    try {
      const availability = await LanguageModel.availability(MODEL_OPTIONS);
      if (availability === 'unavailable') {
        setMessage('この端末は端末内AIの動作条件を満たしていません。通常のおすすめ機能はそのまま利用できます。');
        setStatus('error');
        return;
      }
      if (availability === 'downloadable' || availability === 'downloading') {
        setStatus('downloading');
      }

      session = await LanguageModel.create({
        ...MODEL_OPTIONS,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', (event) => {
            const loaded = 'loaded' in event ? Number(event.loaded) : 0;
            setDownloadProgress(Math.round(Math.max(0, Math.min(1, loaded)) * 100));
            setStatus('downloading');
          });
        },
      });

      setStatus('generating');
      const rawResult = await session.prompt(buildAdvicePrompt(report), {
        responseConstraint: RESPONSE_SCHEMA,
      });
      const parsed = JSON.parse(rawResult) as AdviceResult;
      if (
        typeof parsed.summary !== 'string'
        || typeof parsed.encouragement !== 'string'
        || !Array.isArray(parsed.studyTips)
      ) {
        throw new Error('invalid-ai-response');
      }
      setAdvice({ ...parsed, studyTips: parsed.studyTips.slice(0, 3) });
      setStatus('done');
    } catch (error) {
      console.error('On-device learning advice failed:', error);
      setMessage('端末内AIから回答を取得できませんでした。時間をおいてもう一度お試しください。');
      setStatus('error');
    } finally {
      session?.destroy();
    }
  };

  const busy = status === 'checking' || status === 'downloading' || status === 'generating';

  return (
    <section className="overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-blue-800">
            <BrainCircuit className="h-5 w-5" aria-hidden="true" />
            <h2 className="text-lg font-black">端末内AIのアドバイス</h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            対応端末では、氏名や回答内容を送らず、この画面の集計値だけを端末内で処理します。
          </p>
        </div>
        <Button type="button" onClick={generateAdvice} disabled={busy || report.overall.trackedAttempts === 0} className="shrink-0 bg-blue-700 text-white hover:bg-blue-800">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {status === 'downloading'
            ? `準備中 ${downloadProgress}%`
            : status === 'generating'
              ? '考えています'
              : 'AIからアドバイスをもらう'}
        </Button>
      </div>

      {report.overall.trackedAttempts === 0 && (
        <p className="mt-4 rounded-xl bg-white/80 p-3 text-sm text-slate-600">1回演習すると、AIアドバイスを利用できます。</p>
      )}

      {message && <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}

      {advice && (
        <div className="mt-5 space-y-4 rounded-xl border border-blue-100 bg-white/90 p-4" aria-live="polite">
          <p className="font-bold leading-7 text-slate-900">{advice.summary}</p>
          <ul className="space-y-2 text-sm leading-6 text-slate-700">
            {advice.studyTips.map((tip, index) => (
              <li key={`${index}-${tip}`} className="flex gap-2">
                <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold text-blue-800">{advice.encouragement}</p>
          <p className="text-[11px] text-slate-400">AIによる文章です。学習順は上の集計結果を基準にしてください。</p>
        </div>
      )}
    </section>
  );
}
