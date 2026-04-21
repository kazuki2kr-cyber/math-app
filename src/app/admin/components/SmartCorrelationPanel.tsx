'use client';

import React, { useState } from 'react';
import { AlertCircle, ArrowUpDown, Link2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MathDisplay } from '@/components/MathDisplay';
import type { CorrelationPair } from '@/lib/analytics';

interface SmartCorrelationPanelProps {
  pairs: CorrelationPair[];
  generatedAtLabel?: string | null;
  minSupportUsers?: number;
}

export default function SmartCorrelationPanel({
  pairs,
  generatedAtLabel,
  minSupportUsers,
}: SmartCorrelationPanelProps) {
  const [showMoreCount, setShowMoreCount] = useState(0);

  if (pairs.length === 0) {
    return (
      <Card className="shadow-sm border-dashed">
        <CardHeader>
          <CardTitle className="text-blue-700 flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            問題間の相関分析
          </CardTitle>
          <CardDescription>
            BigQuery の事前集計結果がまだありません。Extension 同期と日次集計が完了すると表示されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-semibold">まだ相関データがありません</p>
          <p className="text-xs mt-2">管理画面では raw attempt を直接読まず、配信用の集計ドキュメントだけを使います。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-md border-t-4 border-t-blue-500">
        <CardHeader>
          <CardTitle className="text-blue-700 flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            問題間の相関分析
          </CardTitle>
          <CardDescription>
            BigQuery で事前計算した相関ペアだけを表示します。分析画面での大量読込を避けつつ、依存関係の強い問題を確認できます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {generatedAtLabel && (
            <p className="text-xs text-muted-foreground">
              集計更新: {generatedAtLabel}
            </p>
          )}
          {typeof minSupportUsers === 'number' && minSupportUsers > 0 && (
            <p className="text-xs text-muted-foreground">
              最小サポート人数: {minSupportUsers}人
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-blue-600" />
            相関の強い問題ペア
          </CardTitle>
          <CardDescription className="text-xs">
            正の相関は一緒にできる傾向、負の相関は片方ができるともう片方で崩れやすい傾向を示します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pairs.slice(0, 5 + showMoreCount).map((pair, index) => (
              <div
                key={`${pair.qIdA}-${pair.qIdB}-${index}`}
                className={`p-4 rounded-lg border flex gap-4 items-start ${
                  pair.direction === 'positive'
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-orange-50 border-orange-200'
                }`}
              >
                <div className="flex flex-col items-center flex-shrink-0">
                  <span className="text-xs font-bold text-muted-foreground">#{index + 1}</span>
                  <span
                    className={`text-lg font-black ${
                      pair.direction === 'positive' ? 'text-blue-700' : 'text-orange-700'
                    }`}
                  >
                    {pair.phi.toFixed(2)}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      pair.strength === 'strong'
                        ? pair.direction === 'positive'
                          ? 'bg-blue-200 text-blue-800'
                          : 'bg-orange-200 text-orange-800'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {pair.strength === 'strong' ? '強い' : '中程度'}
                  </span>
                  {typeof pair.supportUsers === 'number' && pair.supportUsers > 0 && (
                    <span className="mt-1 text-[10px] text-muted-foreground">
                      {pair.supportUsers}人
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-white px-2 py-0.5 rounded text-xs font-bold border">
                      {pair.qIdA}
                    </span>
                    <span className="text-muted-foreground text-xs">×</span>
                    <span className="bg-white px-2 py-0.5 rounded text-xs font-bold border">
                      {pair.qIdB}
                    </span>
                    <span
                      className={`text-[10px] ml-1 ${
                        pair.direction === 'positive' ? 'text-blue-600' : 'text-orange-600'
                      }`}
                    >
                      {pair.direction === 'positive' ? '正の相関' : '負の相関'}
                    </span>
                  </div>
                  <div className="text-gray-700">
                    <span className="font-semibold text-gray-500 mr-2">{pair.qIdA}:</span>
                    <MathDisplay math={pair.qTextA} className="text-sm" />
                  </div>
                  <div className="text-gray-700">
                    <span className="font-semibold text-gray-500 mr-2">{pair.qIdB}:</span>
                    <MathDisplay math={pair.qTextB} className="text-sm" />
                  </div>
                </div>
              </div>
            ))}

            {pairs.length > 5 + showMoreCount && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[10px] h-7 mt-2 text-muted-foreground border-dashed"
                onClick={() => setShowMoreCount((previous) => previous + 30)}
              >
                もっと見る (+30)
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
