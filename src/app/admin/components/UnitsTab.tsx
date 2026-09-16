'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { MathDisplay } from '@/components/MathDisplay';
import { UserAvatarIcon } from '@/components/UserAvatarIcon';

interface UnitsTabProps {
  units: any[];
  loading: boolean;
  unitFilterSubject: string;
  setUnitFilterSubject: (v: string) => void;
  unitFilterCategory: string;
  setUnitFilterCategory: (v: string) => void;
  onDeleteUnit: (unitId: string) => void;
  onDeleteQuestion: (unitId: string, qId: string) => void;
  onToggleQuestionActive: (unitId: string, qId: string, active: boolean) => void;
  onToggleUnitQuestionsActive: (unitId: string, active: boolean) => void;
  updatingQuestionKeys: Set<string>;
  updatingUnitIds: Set<string>;
  onRefresh: () => void;
}

export default function UnitsTab({
  units, loading,
  unitFilterSubject, setUnitFilterSubject,
  unitFilterCategory, setUnitFilterCategory,
  onDeleteUnit, onDeleteQuestion, onToggleQuestionActive, onToggleUnitQuestionsActive,
  updatingQuestionKeys, updatingUnitIds, onRefresh,
}: UnitsTabProps) {
  const filteredUnits = units.filter(u => {
    const sMatch = unitFilterSubject === 'all' || u.subject === unitFilterSubject;
    const cMatch = unitFilterCategory === 'all' || (u.category || 'その他') === unitFilterCategory;
    return sMatch && cMatch;
  });

  const formatEventDate = (value: any) => {
    if (!value) return '未設定';
    if (typeof value === 'string') return value || '未設定';
    if (value?.toDate) return value.toDate().toLocaleString('ja-JP');
    return String(value);
  };

  const renderRubric = (rubric: any) => {
    if (!rubric || (Array.isArray(rubric) && rubric.length === 0)) {
      return <span className="text-xs text-gray-400">未設定</span>;
    }
    if (!Array.isArray(rubric)) {
      return <span className="text-xs text-gray-600">{String(rubric)}</span>;
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {rubric.map((item, index) => (
          <span key={index} className="rounded border bg-white px-2 py-1 text-xs text-gray-600">
            {typeof item === 'string' ? item : `${item.label || '項目'} ${item.points || item.maxScore || ''}`}
          </span>
        ))}
      </div>
    );
  };

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

      {filteredUnits.map(unit => {
        const questionCount = unit.questions?.length || 0;
        const activeQuestionCount = unit.questions?.filter((q: any) => q.active !== false).length || 0;
        const isUpdatingUnit = updatingUnitIds.has(unit.id);
        const isUpdatingQuestionInUnit = Array.from(updatingQuestionKeys).some(key => key.startsWith(`${unit.id}/`));
        const isUnitBusy = isUpdatingUnit || isUpdatingQuestionInUnit;
        return (
          <Card key={unit.id} className="shadow-sm">
          <CardHeader className="flex flex-col gap-4 border-b bg-gray-50 py-4 sm:flex-row sm:items-center sm:justify-between">
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
              {unit.drillType === 'written' && (
                <div className="mt-2 grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
                  <div className="rounded border bg-white px-3 py-2">
                    <span className="font-bold text-gray-700">種別:</span> 記述式イベント
                  </div>
                  <div className="rounded border bg-white px-3 py-2">
                    <span className="font-bold text-gray-700">状態:</span> {unit.eventStatus || 'active'}
                  </div>
                  <div className="rounded border bg-white px-3 py-2">
                    <span className="font-bold text-gray-700">提出上限:</span> {Math.max(2, Number(unit.writtenAttemptLimit) || 2)}回
                  </div>
                  <div className="rounded border bg-white px-3 py-2">
                    <span className="font-bold text-gray-700">満点時XP:</span> {unit.writtenXpBase || 232}
                  </div>
                  <div className="rounded border bg-white px-3 py-2">
                    <span className="font-bold text-gray-700">開始:</span> {formatEventDate(unit.eventStartsAt)}
                  </div>
                  <div className="rounded border bg-white px-3 py-2">
                    <span className="font-bold text-gray-700">終了:</span> {formatEventDate(unit.eventEndsAt)}
                  </div>
                  <div className="rounded border bg-blue-50 px-3 py-2 text-blue-700 sm:col-span-2">
                    総合ランキングの得点対象外（獲得XPは同点時の順位に影響）。1問構成で運用してください。
                  </div>
                </div>
              )}
              <CardDescription>
                問題数: {unit.totalQuestions || 0}問（公開中 {activeQuestionCount}問）
              </CardDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isUnitBusy || questionCount === 0 || activeQuestionCount === questionCount}
                onClick={() => onToggleUnitQuestionsActive(unit.id, true)}
              >
                <Eye className="mr-2 h-4 w-4" /> 全問公開
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isUnitBusy || questionCount === 0 || activeQuestionCount === 0}
                onClick={() => onToggleUnitQuestionsActive(unit.id, false)}
              >
                <EyeOff className="mr-2 h-4 w-4" /> 全問非公開
              </Button>
              <Button variant="destructive" size="sm" disabled={isUnitBusy} onClick={() => onDeleteUnit(unit.id)}>
                <Trash2 className="w-4 h-4 mr-2" /> 単元を削除
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 divide-y max-h-[400px] overflow-y-auto">
            {unit.questions?.map((q: any, i: number) => (
              <div key={q.id} className={`p-4 flex flex-col md:flex-row md:items-start justify-between gap-4 ${q.active === false ? 'bg-gray-100/80 opacity-70' : 'hover:bg-gray-50/50'}`}>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-sm text-gray-500">
                    <span>Q{i + 1}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${q.active === false ? 'bg-gray-200 text-gray-600' : 'bg-emerald-100 text-emerald-700'}`}>
                      {q.active === false ? '非公開' : '公開中'}
                    </span>
                  </div>
                  <div className="text-sm">
                    <MathDisplay math={q.question_text || '問題文なし'} />
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {unit.drillType === 'written' ? (
                      <div className="w-full space-y-2 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                        <div>
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-blue-700">模範解答</p>
                          <MathDisplay math={q.modelAnswer || q.model_answer || q.explanation || '未設定'} />
                        </div>
                        <div>
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-blue-700">採点ルーブリック</p>
                          {renderRubric(q.gradingRubric || q.grading_rubric)}
                        </div>
                        {q.iconReward && (
                          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                            <UserAvatarIcon icon={q.iconReward.imageUrl} className="h-12 w-12" />
                            <div>
                              <p className="font-black">{q.iconReward.name}</p>
                              <p className="text-[11px]">
                                {q.iconReward.condition?.type === 'written_score_at_least'
                                  ? `${q.iconReward.condition.value}点以上で解放`
                                  : '解放条件未対応'}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : q.options?.map((opt: string, oi: number) => (
                      <span key={oi} className={`px-2 py-1 rounded border ${oi + 1 === q.answer_index ? 'bg-green-100 border-green-300 text-green-800 font-bold' : 'bg-white text-gray-500'}`}>
                        {oi + 1}: <MathDisplay math={opt} />
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isUnitBusy}
                    aria-pressed={q.active !== false}
                    onClick={() => onToggleQuestionActive(unit.id, q.id, q.active === false)}
                  >
                    {q.active === false ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
                    {q.active === false ? '公開する' : '非公開にする'}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={isUnitBusy} className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => onDeleteQuestion(unit.id, q.id)}>
                    削除
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
