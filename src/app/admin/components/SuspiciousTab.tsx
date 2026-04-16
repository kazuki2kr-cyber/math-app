'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface SuspiciousTabProps {
  scores: any[];
  suspiciousActivities: any[];
  loading: boolean;
  suspiciousFilter: 'red' | 'yellow' | 'all';
  setSuspiciousFilter: (v: 'red' | 'yellow' | 'all') => void;
  selectedSuspiciousIds: Set<string>;
  setSelectedSuspiciousIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  displaySuspiciousCount: number;
  setDisplaySuspiciousCount: (fn: (prev: number) => number) => void;
  onDeleteScore: (s: any) => void;
  onIgnoreSuspicious: (activityOrId: any) => void;
  onBatchAction: (action: 'ignore' | 'delete') => void;
  onSetUnitForStats: (unitId: string) => void;
  onSwitchToAnalytics: () => void;
  onRefresh: () => void;
}

export default function SuspiciousTab({
  scores, suspiciousActivities, loading,
  suspiciousFilter, setSuspiciousFilter,
  selectedSuspiciousIds, setSelectedSuspiciousIds,
  displaySuspiciousCount, setDisplaySuspiciousCount,
  onDeleteScore, onIgnoreSuspicious, onBatchAction,
  onSetUnitForStats, onSwitchToAnalytics, onRefresh,
}: SuspiciousTabProps) {
  const QUESTIONS_PER_DRILL = 10;

  const suspiciousScores = scores
    .filter(s => s.time != null && s.time > 0 && !s.ignoreFraud)
    .map(s => {
      const avgPerQ = s.time / QUESTIONS_PER_DRILL;
      let flag: 'red' | 'yellow' | 'green' = 'green';
      if (avgPerQ <= 3) flag = 'red';
      else if (avgPerQ <= 5) flag = 'yellow';
      return {
        ...s,
        id: s.docId,
        avgPerQ,
        flag,
        isServer: false,
        updatedAtTime: s.date ? new Date(s.date).getTime() : 0,
        updatedAt: s.date ? new Date(s.date).toISOString() : new Date().toISOString()
      };
    });

  const serverSuspicious = suspiciousActivities.map(s => ({
    id: s.id,
    docId: s.id,
    uid: s.uid,
    userName: s.userName || '不明なユーザー',
    unitId: s.unitId,
    reasons: s.reasons || [],
    updatedAt: s.timestamp?.toDate ? s.timestamp.toDate().toISOString() : new Date().toISOString(),
    updatedAtTime: s.timestamp?.toDate ? s.timestamp.toDate().getTime() : Date.now(),
    isServer: true,
    flag: 'red' as const,
    avgPerQ: 0,
    time: 0,
    score: 0
  }));

  const allSuspicious = [
    ...serverSuspicious,
    ...suspiciousScores.filter(s => s.flag !== 'green')
  ].sort((a, b) => b.updatedAtTime - a.updatedAtTime);

  const filtered = allSuspicious.filter(item => {
    if (suspiciousFilter === 'red') return item.flag === 'red';
    if (suspiciousFilter === 'yellow') return item.flag === 'red' || item.flag === 'yellow';
    return true;
  });

  const handleToggle = (id: string) => {
    const newSet = new Set(selectedSuspiciousIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedSuspiciousIds(newSet);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {selectedSuspiciousIds.size > 0 && (
            <div className="flex items-center gap-1 bg-slate-900 text-white px-2 py-1 rounded-lg animate-in slide-in-from-right-4">
              <span className="text-[10px] font-bold px-2">{selectedSuspiciousIds.size}件選択中</span>
              <Button variant="ghost" size="sm" className="h-7 text-[10px] text-white hover:bg-white/10" onClick={() => onBatchAction('ignore')}>一括無視</Button>
              <Button variant="destructive" size="sm" className="h-7 text-[10px] bg-red-500 hover:bg-red-600" onClick={() => onBatchAction('delete')}>一括削除</Button>
              <Button variant="ghost" size="sm" className="h-7 text-[10px] text-gray-400" onClick={() => setSelectedSuspiciousIds(new Set())}>キャンセル</Button>
            </div>
          )}
          <select
            value={suspiciousFilter}
            onChange={(e) => setSuspiciousFilter(e.target.value as any)}
            className="text-sm border rounded-md px-3 py-1.5 bg-white shadow-sm font-medium"
          >
            <option value="red">🚨 致命的のみ (Server / ≤3s)</option>
            <option value="yellow">⚠️ 要注意以上 (≤5s)</option>
            <option value="all">全件表示</option>
          </select>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="shadow-sm">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> 更新
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-4 text-center">
                <input
                  type="checkbox"
                  onChange={(e) => {
                    if (e.target.checked) setSelectedSuspiciousIds(new Set(filtered.map(f => f.id || f.docId)));
                    else setSelectedSuspiciousIds(new Set());
                  }}
                  checked={filtered.length > 0 && selectedSuspiciousIds.size === filtered.length}
                />
              </th>
              <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider text-center">判定</th>
              <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">ユーザー / 単元</th>
              <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">詳細・検知理由</th>
              <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">日時</th>
              <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider text-center">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.slice(0, displaySuspiciousCount).map((s: any) => (
              <tr key={s.docId} className="hover:bg-gray-50/50">
                <td className="px-4 py-4 text-center">
                  <input
                    type="checkbox"
                    checked={selectedSuspiciousIds.has(s.id || s.docId)}
                    onChange={() => handleToggle(s.id || s.docId)}
                  />
                </td>
                <td className="px-4 py-4 text-center">
                  <span className={`inline-block px-2 py-1 rounded text-[10px] font-black tracking-tighter uppercase shadow-sm ${s.isServer ? 'bg-red-600 text-white' : 'bg-gray-800 text-white'}`}>
                    {s.isServer ? 'SERVER' : 'AUTO'}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <p className="font-bold text-gray-900 flex items-center gap-1.5">
                    {s.userName}
                    {s.flag === 'red' && <AlertTriangle className="w-3 h-3 text-red-500" />}
                  </p>
                  <p className="text-[10px] text-primary font-bold uppercase mt-0.5">{s.unitId}</p>
                </td>
                <td className="px-4 py-4">
                  {s.isServer ? (
                    <ul className="text-xs text-red-800 space-y-0.5 font-medium">
                      {s.reasons.map((r: string, rIdx: number) => (
                        <li key={rIdx} className="flex items-start gap-1">
                          <span className="opacity-50">•</span> {r}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold uppercase leading-none mb-1">平均解答時間</p>
                        <p className={`font-mono font-bold text-base leading-none ${s.flag === 'red' ? 'text-red-600' : 'text-amber-600'}`}>
                          {s.avgPerQ.toFixed(1)}s/問
                        </p>
                      </div>
                      <div className="border-l pl-3">
                        <p className="text-[10px] text-gray-400 font-bold uppercase leading-none mb-1">実績</p>
                        <p className="text-xs font-mono">{s.time}s / {s.score}点</p>
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-4 py-4 text-[10px] text-gray-400 font-mono whitespace-nowrap">
                  {new Date(s.updatedAt).toLocaleString()}
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-1.5 justify-center">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] font-bold px-2"
                      onClick={() => { onSetUnitForStats(s.unitId); onSwitchToAnalytics(); }}
                    >
                      分析
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] font-bold px-2 hover:bg-gray-100"
                      onClick={() => onIgnoreSuspicious(s)}
                    >
                      無視
                    </Button>
                    {!s.isServer && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[10px] font-bold text-red-500 hover:bg-red-50 px-2"
                        onClick={() => onDeleteScore(s)}
                      >
                        削除
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400 italic">
                  {suspiciousFilter === 'all' ? '検知されたデータはありません' : '該当するフィルター条件のデータはありません ✅'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > displaySuspiciousCount && (
        <Button
          variant="outline"
          className="w-full text-xs h-9 text-muted-foreground border-dashed"
          onClick={() => setDisplaySuspiciousCount(prev => prev + 50)}
        >
          もっと見る (+50)
        </Button>
      )}
    </div>
  );
}
