'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, RefreshCw, Database } from 'lucide-react';
import { MathDisplay } from '@/components/MathDisplay';

interface UnitsTabProps {
  units: any[];
  loading: boolean;
  unitFilterSubject: string;
  setUnitFilterSubject: (v: string) => void;
  unitFilterCategory: string;
  setUnitFilterCategory: (v: string) => void;
  onDeleteUnit: (unitId: string) => void;
  onDeleteQuestion: (unitId: string, qId: string) => void;
  onRefresh: () => void;
}

export default function UnitsTab({
  units, loading,
  unitFilterSubject, setUnitFilterSubject,
  unitFilterCategory, setUnitFilterCategory,
  onDeleteUnit, onDeleteQuestion, onRefresh,
}: UnitsTabProps) {
  const filteredUnits = units.filter(u => {
    const sMatch = unitFilterSubject === 'all' || u.subject === unitFilterSubject;
    const cMatch = unitFilterCategory === 'all' || (u.category || 'その他') === unitFilterCategory;
    return sMatch && cMatch;
  });

  return (
    <div className="space-y-6 mt-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gray-50 p-4 rounded-xl border">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-gray-500">教科フィルタ</label>
            <select
              value={unitFilterSubject}
              onChange={(e) => { setUnitFilterSubject(e.target.value); setUnitFilterCategory('all'); }}
              className="text-sm border rounded-md px-3 py-1.5 bg-white font-medium focus:border-primary outline-none"
            >
              <option value="all">すべての教科</option>
              <option value="数学">数学</option>
              <option value="英語">英語</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-gray-500">分野フィルタ</label>
            <select
              value={unitFilterCategory}
              onChange={(e) => setUnitFilterCategory(e.target.value)}
              className="text-sm border rounded-md px-3 py-1.5 bg-white font-medium focus:border-primary outline-none min-w-[150px]"
            >
              <option value="all">すべての分野</option>
              {Array.from(new Set(units
                .filter(u => unitFilterSubject === 'all' || u.subject === unitFilterSubject)
                .map(u => u.category || 'その他')))
                .sort()
                .map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-sm text-gray-500">
            表示中: {filteredUnits.length} / {units.length} 単元
          </p>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className="w-4 h-4 mr-2" /> 再読み込み
          </Button>
        </div>
      </div>

      {filteredUnits.map(unit => (
        <Card key={unit.id} className="shadow-sm">
          <CardHeader className="bg-gray-50 border-b flex flex-row items-center justify-between py-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded uppercase">
                  {unit.subject || '不明'}
                </span>
                <span className="text-xs text-muted-foreground font-medium">
                  分野: {unit.category || 'その他'}
                </span>
              </div>
              <CardTitle className="text-lg text-primary">{unit.title} (ID: {unit.id})</CardTitle>
              <CardDescription>問題数: {unit.totalQuestions || 0}問</CardDescription>
            </div>
            <Button variant="destructive" size="sm" onClick={() => onDeleteUnit(unit.id)}>
              <Trash2 className="w-4 h-4 mr-2" /> 単元を削除
            </Button>
          </CardHeader>
          <CardContent className="p-0 divide-y max-h-[400px] overflow-y-auto">
            {unit.questions?.map((q: any, i: number) => (
              <div key={q.id} className="p-4 hover:bg-gray-50/50 flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="font-semibold text-sm text-gray-500">Q{i + 1}</div>
                  <div className="text-sm">
                    <MathDisplay math={q.question_text || '問題文なし'} />
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {q.options?.map((opt: string, oi: number) => (
                      <span key={oi} className={`px-2 py-1 rounded border ${oi + 1 === q.answer_index ? 'bg-green-100 border-green-300 text-green-800 font-bold' : 'bg-white text-gray-500'}`}>
                        {oi + 1}: <MathDisplay math={opt} />
                      </span>
                    ))}
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => onDeleteQuestion(unit.id, q.id)}>
                  削除
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
