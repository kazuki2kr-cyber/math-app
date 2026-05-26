'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Swords, Trophy } from 'lucide-react';

interface BattleResult {
  uid: string;
  name?: string;
  totalScore?: number;
  correctCount?: number;
  totalQuestions?: number;
  totalTimeMs?: number;
  rank?: number;
  xpDelta?: number;
  abandoned?: boolean;
}

interface KanjiBattleHistoryTabProps {
  battles: any[];
  loading: boolean;
  onRefresh: () => void;
}

function formatDate(value: any) {
  if (!value) return '-';
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString('ja-JP');
  if (typeof value === 'string' || typeof value === 'number') return new Date(value).toLocaleString('ja-JP');
  return '-';
}

function getSortedResults(results: Record<string, BattleResult> | undefined) {
  return Object.values(results || {}).sort((a, b) => {
    if ((a.rank || 999) !== (b.rank || 999)) return (a.rank || 999) - (b.rank || 999);
    if ((b.totalScore || 0) !== (a.totalScore || 0)) return (b.totalScore || 0) - (a.totalScore || 0);
    return (a.totalTimeMs || 0) - (b.totalTimeMs || 0);
  });
}

export default function KanjiBattleHistoryTab({ battles, loading, onRefresh }: KanjiBattleHistoryTabProps) {
  return (
    <Card className="border-t-4 border-t-orange-500 shadow-sm mt-4 font-serif">
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-orange-950 flex items-center gap-2">
              <Swords className="h-5 w-5 text-orange-600" />
              対戦モード履歴
            </CardTitle>
            <CardDescription>
              確定済みの漢字対戦結果を新しい順に表示します。
            </CardDescription>
          </div>
          <Button variant="outline" onClick={onRefresh} disabled={loading} className="border-orange-200 text-orange-900 bg-white">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            再読み込み
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
          </div>
        ) : battles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-orange-200 bg-white/70 p-8 text-center text-sm font-bold text-orange-900/50">
            確定済みの対戦履歴がありません。
          </div>
        ) : (
          <div className="space-y-4">
            {battles.map((battle) => {
              const results = getSortedResults(battle.results);
              const winner = results.find((result) => !result.abandoned);

              return (
                <div key={battle.docId} className="rounded-xl border border-orange-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black text-orange-950">Room {battle.roomId || battle.docId}</h3>
                        <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-700">
                          {battle.playerCount || results.length || 0}人対戦
                        </span>
                        {winner && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
                            <Trophy className="h-3.5 w-3.5" />
                            1位: {winner.name || winner.uid}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs font-semibold text-orange-900/60">
                        単元: {battle.unitId || '-'} / 確定日時: {formatDate(battle.finalizedAt)}
                      </p>
                    </div>
                    <p className="text-xs font-mono text-orange-900/40">finalizedBy: {battle.finalizedBy || '-'}</p>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead className="border-b bg-orange-50/60 text-xs text-orange-900/70">
                        <tr>
                          <th className="px-3 py-2">順位</th>
                          <th className="px-3 py-2">ユーザー</th>
                          <th className="px-3 py-2 text-right">スコア</th>
                          <th className="px-3 py-2 text-right">正答</th>
                          <th className="px-3 py-2 text-right">時間</th>
                          <th className="px-3 py-2 text-right">対戦XP</th>
                          <th className="px-3 py-2">状態</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y text-gray-700">
                        {results.map((result) => (
                          <tr key={result.uid}>
                            <td className="px-3 py-2 font-black text-orange-900">{result.rank || '-'}</td>
                            <td className="px-3 py-2">
                              <p className="font-bold">{result.name || result.uid}</p>
                              <p className="text-[10px] font-mono text-gray-400">{result.uid}</p>
                            </td>
                            <td className="px-3 py-2 text-right font-black">{result.totalScore ?? 0}</td>
                            <td className="px-3 py-2 text-right">{result.correctCount ?? 0}/{result.totalQuestions ?? 0}</td>
                            <td className="px-3 py-2 text-right">{Math.round((result.totalTimeMs || 0) / 1000)}秒</td>
                            <td className={`px-3 py-2 text-right font-black ${(result.xpDelta || 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                              {(result.xpDelta || 0) >= 0 ? '+' : ''}{result.xpDelta ?? 0}
                            </td>
                            <td className="px-3 py-2">
                              {result.abandoned ? (
                                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-500">離脱</span>
                              ) : (
                                <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">完了</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
