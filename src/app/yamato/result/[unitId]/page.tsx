'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Trophy, TrendingUp, XCircle, CheckCircle, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import Image from 'next/image';

interface ResultData {
  score: number;
  isHighScore: boolean;
  isLevelUp: boolean;
  oldLevel: number;
  newLevel: number;
  xpGain: number;
  newTotalXp: number;
  time: number;
  correctQuestions: any[];
  wrongQuestions: any[];
  recognizedChars?: any[];
}

export default function KanjiResultPage({ params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = React.use(params);
  const router = useRouter();
  const [result, setResult] = useState<ResultData | null>(null);
  const [composedImage, setComposedImage] = useState<string | null>(null);

  useEffect(() => {
    // SessionStorageから結果を復元
    const dataStr = sessionStorage.getItem('kanji_last_result');
    const imageStr = sessionStorage.getItem('kanji_composed_image');
    
    if (dataStr) {
      setResult(JSON.parse(dataStr));
    } else {
      // 結果がない場合はトップへ戻す
      alert('結果データが見つかりません');
      router.replace('/yamato');
    }

    if (imageStr) {
      setComposedImage(imageStr);
    }
  }, [router]);

  if (!result) {
    return (
      <div className="min-h-screen bg-[#FDF6E3] flex items-center justify-center font-serif text-orange-900">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const {
    score, isHighScore, isLevelUp, newLevel, xpGain, wrongQuestions, correctQuestions, time
  } = result;

  return (
    <div className="min-h-screen bg-[#FDF6E3] font-serif py-8 px-4 md:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header & Score Card */}
        <Card className="overflow-hidden border-orange-900/20 shadow-xl bg-white relative">
          <div className="absolute top-0 left-0 w-full h-2 bg-orange-600" />
          <div className="p-8 md:p-12 text-center flex flex-col items-center">
            
            <div className="mb-4 inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-100 text-orange-900 shadow-inner">
              <Trophy className="w-8 h-8" />
            </div>

            <h1 className="text-3xl md:text-5xl font-black text-orange-950 mb-2">
              結果発表
            </h1>
            
            {isHighScore && (
              <span className="inline-block mt-2 px-3 py-1 bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-bold rounded-full shadow tracking-wider animate-bounce">
                NEW RECORD!
              </span>
            )}

            <div className="mt-8 flex flex-col items-center">
              <span className="text-sm font-bold text-orange-900/60 uppercase tracking-widest mb-1">SCORE</span>
              <div className="text-6xl md:text-8xl font-black text-gray-900 tracking-tighter">
                {score}
              </div>
            </div>

            <div className="flex gap-8 mt-8 border-t border-orange-100 pt-6 w-full justify-center">
              <div className="text-center">
                <span className="text-xs text-orange-900/60 font-bold block mb-1">TIME</span>
                <span className="text-xl font-bold text-gray-800">{time}秒</span>
              </div>
              <div className="text-center">
                <span className="text-xs text-orange-900/60 font-bold block mb-1">XP GAIN</span>
                <span className="text-xl font-bold text-orange-600">+{xpGain} XP</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Level Up Banner */}
        {isLevelUp && (
          <div className="bg-gradient-to-r from-orange-600 to-red-600 rounded-2xl p-6 text-white shadow-xl flex items-center justify-between animate-in fade-in slide-in-from-bottom-4">
            <div>
              <h2 className="text-2xl font-black flex items-center gap-2">
                <Sparkles className="text-yellow-300" /> レベルアップ！
              </h2>
              <p className="opacity-90 mt-1">漢字レベルが {newLevel} に上がりました。新たな称号を獲得しました！</p>
            </div>
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center font-black text-3xl">
              {newLevel}
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-8">
          
          {/* 分割：左側は結果リスト、右側は手書き画像 */}
          <div className="space-y-8">
            {/* Wrong Answers */}
            <Card className="p-6 border-orange-900/10 shadow-sm bg-white">
              <h3 className="text-lg font-bold text-orange-950 border-b border-orange-100 pb-3 mb-4 flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-500" /> 復習が必要な漢字 ({wrongQuestions.length}問)
              </h3>
              
              {wrongQuestions.length === 0 ? (
                <div className="text-center py-8 text-orange-900/60">
                  <p>完璧です！復習が必要な漢字はありません。</p>
                </div>
              ) : (
                <ul className="space-y-4">
                  {wrongQuestions.map((q, idx) => (
                    <li key={idx} className="bg-orange-50/50 p-4 rounded-xl border border-orange-100">
                      <div className="text-sm text-gray-500 mb-1" dangerouslySetInnerHTML={{ __html: q.question_text || '' }}></div>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 bg-white p-2 rounded border border-red-200 text-center">
                          <span className="text-xs text-red-400 block mb-1">判定結果</span>
                          <span className="text-xl font-black text-red-600">{q.recognizedText || '（認識不能）'}</span>
                        </div>
                        <ArrowRight className="text-gray-300" />
                        <div className="flex-1 bg-white p-2 rounded border border-green-200 text-center">
                          <span className="text-xs text-green-500 block mb-1">正解</span>
                          <span className="text-xl font-black text-green-600">{q.correctOptionText}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Correct Answers */}
            <Card className="p-6 border-orange-900/10 shadow-sm bg-white">
              <h3 className="text-lg font-bold text-orange-950 border-b border-orange-100 pb-3 mb-4 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" /> 正解した漢字 ({correctQuestions.length}問)
              </h3>
              
              {correctQuestions.length === 0 ? (
                <div className="text-center py-8 text-orange-900/60">
                  <p>今回は正解した漢字はありませんでした。</p>
                </div>
              ) : (
                <ul className="space-y-4">
                  {correctQuestions.map((q, idx) => (
                    <li key={idx} className="bg-green-50/30 p-4 rounded-xl border border-green-100/50">
                      <div className="text-sm text-gray-500 mb-1" dangerouslySetInnerHTML={{ __html: q.question_text || '' }}></div>
                      <div className="flex items-center gap-4">
                        <div className="w-full bg-white p-2 rounded border border-green-200 text-center flex justify-center items-center gap-4">
                          <span className="text-xs text-green-600 font-bold block">あなたの字は <span className="text-xl font-black mx-2">{q.recognizedText}</span> と判定されました！</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* User's Submitted Composition (Debug / Review) */}
          <div className="space-y-8">
            <Card className="p-6 border-orange-900/10 shadow-sm bg-white sticky top-8">
              <h3 className="text-lg font-bold text-orange-950 border-b border-orange-100 pb-3 mb-4">
                提出した手書き画像
              </h3>
              <div className="bg-gray-50 rounded-xl overflow-hidden border border-gray-200 aspect-square relative">
                {composedImage ? (
                   <Image src={composedImage} alt="Composed Handwriting" fill className="object-contain" />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400">画像なし</div>
                )}
              </div>
            </Card>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex justify-center pt-8">
          <Button 
            onClick={() => router.push('/yamato')}
            className="w-full max-w-sm h-14 text-lg font-bold bg-orange-900 hover:bg-orange-950 text-white shadow-lg"
          >
            ダッシュボードへ戻る
          </Button>
        </div>
      </div>
    </div>
  );
}
