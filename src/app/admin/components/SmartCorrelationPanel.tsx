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
            誤答相関
          </CardTitle>
          <CardDescription>
            ここには「同時に間違えやすい問題ペア」だけが表示されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-semibold">まだ誤答相関データがありません</p>
          <p className="text-xs mt-2">
            集計前か、同時に間違えた人数が基準未満です。
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
            誤答相関
          </CardTitle>
          <CardDescription>
            この一覧は正答どうしの相関ではありません。
            「問題Aを間違えた生徒が、問題Bも間違えやすいか」を見ています。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-semibold">見方</p>
            <p className="mt-1">
              大きく表示している数字は「両方を間違えた人数」です。下には
              「Aを間違えた人のうち何%がBも間違えたか」を表示しています。
            </p>
          </div>
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
            どちらも正解した組み合わせではなく、誤答の連動だけを抽出しています。
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
                  <span className="mt-1 text-[10px] text-muted-foreground">両方を誤答</span>
                  <span
                    className={`mt-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      pair.strength === 'strong'
                        ? 'bg-amber-200 text-amber-800'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {pair.strength === 'strong' ? '強い' : '中程度'}
                  </span>
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
                    <span className="text-[10px] ml-1 text-amber-700">誤答どうしの関係</span>
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
                      <span className="font-semibold">{pair.qIdA}</span> を間違えた人のうち
                      <span className="mx-1 font-semibold text-amber-700">
                        {formatRate(pair.mistakeRateGivenA)}%
                      </span>
                      が <span className="font-semibold">{pair.qIdB}</span> も間違えています
                    </div>
                    <div className="rounded-md bg-white/70 px-2 py-1 border border-amber-100">
                      <span className="font-semibold">{pair.qIdB}</span> を間違えた人のうち
                      <span className="mx-1 font-semibold text-amber-700">
                        {formatRate(pair.mistakeRateGivenB)}%
                      </span>
                      が <span className="font-semibold">{pair.qIdA}</span> も間違えています
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px] text-gray-500">
                    <span>誤答相関 φ {pair.phi.toFixed(2)}</span>
                    {typeof pair.lift === 'number' && Number.isFinite(pair.lift) && (
                      <span>誤答リフト {pair.lift.toFixed(2)}</span>
                    )}
                    {typeof pair.wrongUsersA === 'number' && (
                      <span>{pair.qIdA} の誤答者 {pair.wrongUsersA}人</span>
                    )}
                    {typeof pair.wrongUsersB === 'number' && (
                      <span>{pair.qIdB} の誤答者 {pair.wrongUsersB}人</span>
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
