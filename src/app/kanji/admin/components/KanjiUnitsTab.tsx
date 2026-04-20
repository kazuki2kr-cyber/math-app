'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Trash2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, deleteDoc, collection, getDocs, writeBatch } from 'firebase/firestore';

interface KanjiUnitsTabProps {
  units: any[];
  loading: boolean;
  refreshUnits: () => void;
  setMessage: (v: string) => void;
}

export default function KanjiUnitsTab({ units, loading, refreshUnits, setMessage }: KanjiUnitsTabProps) {

  const handleDeleteUnit = async (unitId: string) => {
    if (!window.confirm('この漢字単元と、そこに紐づく問題をすべて削除しますか？\n（※回答データには影響しませんが、プレイできなくなります）')) return;
    try {
      // Questions subcollection
      const qSnap = await getDocs(collection(db, 'units', unitId, 'questions'));
      const batch = writeBatch(db);
      qSnap.forEach(d => {
        batch.delete(d.ref);
      });
      await batch.commit();

      // Main doc
      await deleteDoc(doc(db, 'units', unitId));
      setMessage(`✅ 漢字単元 ${unitId} を削除しました。`);
      refreshUnits();
    } catch (e: any) {
      console.error(e);
      setMessage(`エラー: ${e.message}`);
    }
  };

  const kanjiUnits = units.filter(u => u.subject === 'kanji' || u.subject === '漢字');

  return (
    <Card className="border-t-4 border-t-orange-500 shadow-sm mt-4 font-serif">
      <CardHeader>
        <CardTitle className="text-orange-950">漢字単元一覧</CardTitle>
        <CardDescription>現在登録されている漢字のドリル一覧です。</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
          </div>
        ) : kanjiUnits.length === 0 ? (
          <div className="text-center p-8 text-orange-900/40">
            登録されている漢字単元はありません。
          </div>
        ) : (
          <div className="space-y-4">
            {kanjiUnits.map(unit => {
              const qs = unit.questions || [];
              const questionsCount = unit.totalQuestions !== undefined ? unit.totalQuestions : qs.length;

              return (
                <div key={unit.id} className="border border-orange-100 p-4 rounded-xl hover:bg-orange-50/50 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-bold text-orange-950 text-lg">
                        {unit.title}
                        <span className="ml-2 text-xs font-normal text-orange-900/60 bg-white border border-orange-100 px-2 py-0.5 rounded-full">
                          {unit.category || 'カテゴリ未設定'}
                        </span>
                      </h3>
                      <p className="text-xs text-orange-900/50 font-mono mt-1">ID: {unit.id}</p>
                    </div>
                    <Button 
                      variant="destructive" 
                      size="sm" 
                      onClick={() => handleDeleteUnit(unit.id)}
                      className="bg-red-50 hover:bg-red-100 text-red-600 border-red-200 border"
                    >
                      <Trash2 className="w-4 h-4 mr-1" /> 単元を削除
                    </Button>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-orange-100/50 text-sm">
                    <p className="font-semibold mb-2 text-orange-900">問題一覧 ({questionsCount}問)</p>
                    <div className="max-h-40 overflow-y-auto space-y-2 pr-2">
                      {qs.map((q: any) => (
                        <div key={q.id} className="text-xs flex gap-2 items-start text-gray-600 pb-2 border-b border-gray-50 last:border-0">
                          <span className="font-mono text-gray-400 w-16 flex-shrink-0">{q.id}</span>
                          <span className="flex-1" dangerouslySetInnerHTML={{ __html: q.question_text }} />
                          <span className="font-bold text-orange-700 bg-orange-50 px-2 rounded min-w-[30px] text-center">
                            {q.answer || '(解答なし)'}
                          </span>
                        </div>
                      ))}
                      {qs.length === 0 && <p className="text-xs text-gray-400">問題データがロードされていません</p>}
                    </div>
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
