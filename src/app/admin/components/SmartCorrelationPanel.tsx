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

function formatRate(value?: number) {
  return Number(value || 0).toFixed(1);
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
          <CardTitle className="text-amber-700 flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            誤答の相関分析
          </CardTitle>
          <CardDescription>
            BigQuery の集計が終わると、「この問題を間違えた生徒は別のこの問題も間違えやすい」
            という組み合わせがここに並びます。
          </CardDescription>
        </CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-semibold">まだ誤答相関データがありません</p>
          <p className="text-xs mt-2">
            集計前か、同時に間違える人数が閾値に届いていない状態です。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-md border-t-4 border-t-amber-500">
        <CardHeader>
          <CardTitle className="text-amber-700 flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            誤答の相関分析
          </CardTitle>
          <CardDescription>
            正解どうしの一致ではなく、誤答が連動して起きる問題ペアだけを表示しています。
            教材のつまずき箇所を探すための一覧です。
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
              最小対象人数: {minSupportUsers}人
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-amber-600" />
            同時に間違えやすい問題ペア
          </CardTitle>
          <CardDescription className="text-xs">
            両方を間違えた人数と、「Aを間違えた生徒がBも間違える率」を中心に表示します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pairs.slice(0, 5 + showMoreCount).map((pair, index) => (
              <div
                key={`${pair.qIdA}-${pair.qIdB}-${index}`}
                className="p-4 rounded-lg border flex gap-4 items-start bg-amber-50 border-amber-200"
              >
                <div className="flex flex-col items-center flex-shrink-0">
                  <span className="text-xs font-bold text-muted-foreground">#{index + 1}</span>
                  <span className="text-lg font-black text-amber-700">
                    {pair.coWrongUsers ?? 0}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      pair.strength === 'strong'
                        ? 'bg-amber-200 text-amber-800'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {pair.strength === 'strong' ? '強い' : '中程度'}
                  </span>
                  <span className="mt-1 text-[10px] text-muted-foreground">両方を誤答</span>
                  {typeof pair.supportUsers === 'number' && pair.supportUsers > 0 && (
                    <span className="mt-1 text-[10px] text-muted-foreground">
                      対象 {pair.supportUsers}人
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
                    <span className="text-[10px] ml-1 text-amber-700">連動誤答</span>
                  </div>
                  <div className="text-gray-700">
                    <span className="font-semibold text-gray-500 mr-2">{pair.qIdA}:</span>
                    <MathDisplay math={pair.qTextA} className="text-sm" />
                  </div>
                  <div className="text-gray-700">
                    <span className="font-semibold text-gray-500 mr-2">{pair.qIdB}:</span>
                    <MathDisplay math={pair.qTextB} className="text-sm" />
                  </div>

                  <div className="grid gap-2 pt-1 text-xs text-gray-600 md:grid-cols-2">
                    <div className="rounded-md bg-white/70 px-2 py-1 border border-amber-100">
                      {pair.qIdA} を間違えた人のうち{' '}
                      <span className="font-semibold text-amber-700">
                        {formatRate(pair.mistakeRateGivenA)}%
                      </span>{' '}
                      が {pair.qIdB} も間違えています
                    </div>
                    <div className="rounded-md bg-white/70 px-2 py-1 border border-amber-100">
                      {pair.qIdB} を間違えた人のうち{' '}
                      <span className="font-semibold text-amber-700">
                        {formatRate(pair.mistakeRateGivenB)}%
                      </span>{' '}
                      が {pair.qIdA} も間違えています
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px] text-gray-500">
                    <span>誤答相関 φ {pair.phi.toFixed(2)}</span>
                    {typeof pair.lift === 'number' && Number.isFinite(pair.lift) && (
                      <span>誤答リフト {pair.lift.toFixed(2)}</span>
                    )}
                    {typeof pair.wrongUsersA === 'number' && (
                      <span>{pair.qIdA} 誤答者 {pair.wrongUsersA}人</span>
                    )}
                    {typeof pair.wrongUsersB === 'number' && (
                      <span>{pair.qIdB} 誤答者 {pair.wrongUsersB}人</span>
                    )}
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
