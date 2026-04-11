'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart as BarChartIcon, RefreshCw, ArrowUpDown, Link2 } from 'lucide-react';
import {
  calculatePhi,
  extractSignificantCorrelations,
  type CorrelationPair,
} from '@/lib/analytics';
import {
  collection, getDocs, collectionGroup, query, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { MathDisplay } from '@/components/MathDisplay';


interface SmartCorrelationPanelProps {
  unitId: string;
  questions: Array<{ id: string; question_text: string }>;
}

export default function SmartCorrelationPanel({ unitId, questions }: SmartCorrelationPanelProps) {
  const [isComputing, setIsComputing] = useState(false);
  const [correlationPairs, setCorrelationPairs] = useState<CorrelationPair[] | null>(null);
  const [fullMatrix, setFullMatrix] = useState<number[][] | null>(null);
  const [showFullMatrix, setShowFullMatrix] = useState(false);
  const [lastComputed, setLastComputed] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [showMoreCount, setShowMoreCount] = useState(0);

  /**
   * 相関計算 — 既存の computeCorrelation ロジックを完全に踏襲
   * ユーザーがボタンを押したときのみ実行される（自動実行なし）
   */
  const computeCorrelation = async () => {
    setIsComputing(true);
    try {
      // 1. ユーザー一覧の取得は不要（attempts から抽出可能）

      // 2. 該当単元の attempts を collectionGroup で一括取得
      //    既存のロジック: users/{uid}/attempts をユーザーごとに取得していた
      //    → collectionGroup query で 1 回にまとめ、Firestore 読み取り回数を削減
      const attemptsQuery = query(
        collectionGroup(db, 'attempts'),
        where('unitId', '==', unitId)
      );
      const attemptsSnap = await getDocs(attemptsQuery);
      
      // ユーザーごとに集約
      const userAttempts: Record<string, Array<{ qId: string; isCorrect: boolean }>> = {};
      for (const doc of attemptsSnap.docs) {
        // パスから uid を抽出: users/{uid}/attempts/{attemptId}
        const pathParts = doc.ref.path.split('/');
        const uid = pathParts[1];
        const details = doc.data().details || [];
        if (!userAttempts[uid]) userAttempts[uid] = [];
        for (const d of details) {
          userAttempts[uid].push({ qId: d.qId, isCorrect: d.isCorrect });
        }
      }

      setAttemptCount(attemptsSnap.size);

      // 3. 二値ベクトル構築（既存ロジックと同一）
      const qIds = questions.map((q) => q.id?.toString());
      const n = qIds.length;
      const vectors: number[][] = Array.from({ length: n }, () => []);

      for (const uid of Object.keys(userAttempts)) {
        const attempts = userAttempts[uid];
        for (let qi = 0; qi < n; qi++) {
          const matched = attempts.find((a) => a.qId === qIds[qi]);
          vectors[qi].push(matched ? (matched.isCorrect ? 1 : 0) : -1); // -1 = 未回答
        }
      }

      // -1（未回答）を除外したペアのみでPhi計算
      const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
          if (i === j) {
            matrix[i][j] = 1;
            continue;
          }
          const v1: number[] = [];
          const v2: number[] = [];
          for (let u = 0; u < vectors[i].length; u++) {
            if (vectors[i][u] !== -1 && vectors[j][u] !== -1) {
              v1.push(vectors[i][u]);
              v2.push(vectors[j][u]);
            }
          }
          const phi = v1.length >= 3 ? calculatePhi(v1, v2) : 0;
          matrix[i][j] = phi;
          matrix[j][i] = phi;
        }
      }

      setFullMatrix(matrix);

      // 4. 顕著な相関ペアを抽出（|φ| >= 0.5）
      const pairs = extractSignificantCorrelations(matrix, questions, 0.5);
      setCorrelationPairs(pairs);
      setLastComputed(new Date().toLocaleString('ja-JP'));
    } catch (error) {
      console.error('[SmartCorrelation] Error:', error);
    } finally {
      setIsComputing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 計算ボタンカード */}
      <Card className="shadow-md border-t-4 border-t-blue-500">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle className="text-blue-700 flex items-center gap-2">
              <Link2 className="w-5 h-5" />
              問題間の相関分析
            </CardTitle>
            <CardDescription className="max-w-xl">
              問題間の正誤の相関係数（Phi係数）を算出し、|φ| ≥ 0.5 の顕著な相関ペアを抽出します。
              ある問題を間違えた生徒が別の問題も間違えやすい等の傾向分析に利用できます。
            </CardDescription>
          </div>
          <Button onClick={computeCorrelation} disabled={isComputing}>
            {isComputing ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <BarChartIcon className="w-4 h-4 mr-2" />
            )}
            {isComputing ? '計算中...' : '相関を計算する'}
          </Button>
        </CardHeader>
        <CardContent>
          {lastComputed && (
            <p className="text-xs text-muted-foreground">
              最終計算: {lastComputed} ・ 分析対象 attempt 数: {attemptCount}件
            </p>
          )}
        </CardContent>
      </Card>

      {/* 顕著な相関ペアランキング */}
      {correlationPairs !== null && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-800 flex items-center gap-2">
              <ArrowUpDown className="w-4 h-4 text-blue-600" />
              顕著な相関ペア（|φ| ≥ 0.5）
            </CardTitle>
            <CardDescription className="text-xs">
              相関の強い順にランキング。正の相関は「連鎖ミス」、負の相関は「相反傾向」を示します。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {correlationPairs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="font-semibold">|φ| ≥ 0.5 の顕著な相関は見つかりませんでした</p>
                <p className="text-xs mt-2">データが蓄積されると相関が検出される可能性があります。</p>
              </div>
            ) : (
              <div className="space-y-3">
                {correlationPairs.slice(0, 5 + (showMoreCount || 0)).map((pair, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg border flex gap-4 items-start ${
                      pair.direction === 'positive'
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-orange-50 border-orange-200'
                    }`}
                  >
                    {/* ランク表示 */}
                    <div className="flex flex-col items-center flex-shrink-0">
                      <span className="text-xs font-bold text-muted-foreground">#{idx + 1}</span>
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
                    </div>

                    {/* 問題ペア */}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="bg-white px-2 py-0.5 rounded text-xs font-bold border">
                          Q{pair.indexA + 1}
                        </span>
                        <span className="text-muted-foreground text-xs">↔</span>
                        <span className="bg-white px-2 py-0.5 rounded text-xs font-bold border">
                          Q{pair.indexB + 1}
                        </span>
                        <span
                          className={`text-[10px] ml-1 ${
                            pair.direction === 'positive' ? 'text-blue-600' : 'text-orange-600'
                          }`}
                        >
                          {pair.direction === 'positive' ? '正の相関（連鎖ミス）' : '負の相関（相反傾向）'}
                        </span>
                      </div>
                        <div className="text-gray-700">
                          <span className="font-semibold text-gray-500 mr-2">Q{pair.indexA + 1}:</span>
                          <MathDisplay math={pair.qTextA} className="text-sm" />
                        </div>
                        <div className="text-gray-700">
                          <span className="font-semibold text-gray-500 mr-2">Q{pair.indexB + 1}:</span>
                          <MathDisplay math={pair.qTextB} className="text-sm" />
                        </div>
                    </div>
                  </div>
                ))}
                {correlationPairs.length > 5 + (showMoreCount || 0) && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full text-[10px] h-7 mt-2 text-muted-foreground border-dashed"
                    onClick={() => setShowMoreCount(prev => (prev || 0) + 30)}
                  >
                    もっと見る (+30)
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 従来のフル相関行列（折りたたみ表示） */}
      {fullMatrix && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold text-gray-600">
                フル相関行列（ヒートマップ）
              </CardTitle>
              <CardDescription className="text-xs">
                従来の全問題間ヒートマップ表示。詳細分析用。
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowFullMatrix(!showFullMatrix)}>
              {showFullMatrix ? '閉じる' : '表示する'}
            </Button>
          </CardHeader>
          {showFullMatrix && (
            <CardContent>
              <div className="overflow-x-auto pb-4">
                <table className="w-full text-xs text-center border-collapse min-w-max">
                  <thead>
                    <tr>
                      <th className="p-2 border bg-gray-50 uppercase tracking-widest text-muted-foreground w-12 sticky left-0 z-10">
                        Q
                      </th>
                      {questions.map((_: any, i: number) => (
                        <th key={i} className="p-2 border bg-gray-50 min-w-[3rem]" title={questions[i].question_text}>
                          Q{i + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map((_: any, i: number) => (
                      <tr key={i}>
                        <th className="p-2 border bg-gray-50 text-left truncate max-w-[100px] sticky left-0 z-10">
                          <div className="flex items-center gap-2">
                            <span className="font-bold">Q{i + 1}</span>
                          </div>
                        </th>
                        {questions.map((__: any, j: number) => {
                          const val = fullMatrix[i][j];
                          let bg = 'white';
                          let textColor = 'inherit';
                          if (i === j) {
                            bg = '#f3f4f6';
                          } else if (val > 0) {
                            bg = `rgba(59, 130, 246, ${Math.min(val * 0.9, 0.9)})`;
                            if (val > 0.5) textColor = 'white';
                          } else if (val < 0) {
                            bg = `rgba(239, 68, 68, ${Math.min(Math.abs(val) * 0.9, 0.9)})`;
                            if (Math.abs(val) > 0.5) textColor = 'white';
                          }
                          return (
                            <td
                              key={j}
                              className="p-2 border font-mono font-medium"
                              style={{ backgroundColor: bg, color: textColor }}
                            >
                              {val === 0 ? '0.00' : val.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
