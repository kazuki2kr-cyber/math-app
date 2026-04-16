'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, RefreshCw } from 'lucide-react';

interface ScoresTabProps {
  scores: any[];
  loading: boolean;
  displayScoresCount: number;
  setDisplayScoresCount: (fn: (prev: number) => number) => void;
  selectedScoreIds: Set<string>;
  onToggleSelect: (docId: string) => void;
  onSelectAll: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBatchDelete: () => void;
  onDeleteScore: (s: any) => void;
  onRefresh: () => void;
}

export default function ScoresTab({
  scores, loading,
  displayScoresCount, setDisplayScoresCount,
  selectedScoreIds,
  onToggleSelect, onSelectAll, onBatchDelete, onDeleteScore, onRefresh,
}: ScoresTabProps) {
  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-between items-center border-b pb-2">
        <div className="flex items-center gap-4">
          <p className="text-sm text-gray-500">総プレイデータ（Attempts）</p>
          {selectedScoreIds.size > 0 && (
            <Button variant="destructive" size="sm" onClick={onBatchDelete} disabled={loading}>
              <Trash2 className="w-4 h-4 mr-2" /> 選択した項目を削除 ({selectedScoreIds.size}件)
            </Button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className="w-4 h-4 mr-2" /> 再読み込み
        </Button>
      </div>

      <div className="bg-white rounded-md shadow overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 text-gray-600 border-b">
            <tr>
              <th className="px-4 py-3">
                <input type="checkbox" onChange={onSelectAll} checked={scores.length > 0 && selectedScoreIds.size === scores.length} />
              </th>
              <th className="px-4 py-3">日時</th>
              <th className="px-4 py-3">ユーザー名</th>
              <th className="px-4 py-3">単元ID</th>
              <th className="px-4 py-3">スコア</th>
              <th className="px-4 py-3">時間</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y text-gray-600">
            {scores.slice(0, displayScoresCount).map(s => (
              <tr key={s.docId} className="hover:bg-gray-50/50">
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selectedScoreIds.has(s.docId)} onChange={() => onToggleSelect(s.docId)} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {s.date ? new Date(s.date).toLocaleString() : '-'}
                </td>
                <td className="px-4 py-3">{s.userName || s.uid || '-'}</td>
                <td className="px-4 py-3 font-medium text-primary">{s.unitId}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-1 rounded-full text-xs font-bold ${(s.maxScore ?? s.score ?? 0) >= 80 ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`}>
                    {s.maxScore ?? s.score ?? '-'}点
                  </span>
                </td>
                <td className="px-4 py-3">
                  {(() => {
                    const t = s.bestTime ?? s.time;
                    const numT = Number(t);
                    if (t != null && !isNaN(numT)) {
                      return `${Math.floor(numT / 60)}分${numT % 60}秒`;
                    }
                    return '-';
                  })()}
                </td>
                <td className="px-4 py-3">
                  <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => onDeleteScore(s)}>
                    データ削除
                  </Button>
                </td>
              </tr>
            ))}
            {scores.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">データがありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {scores.length > displayScoresCount && (
        <Button
          variant="outline"
          className="w-full text-xs h-9 text-muted-foreground border-dashed"
          onClick={() => setDisplayScoresCount(prev => prev + 100)}
        >
          もっと見る (+100)
        </Button>
      )}
    </div>
  );
}
