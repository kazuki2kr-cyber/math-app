'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection, getDocs, deleteDoc, updateDoc } from 'firebase/firestore';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Trash2, RefreshCw, FileText, Database, UserCheck } from 'lucide-react';
import { MathDisplay } from '@/components/MathDisplay';

export default function AdminPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  const [activeTab, setActiveTab] = useState<'import' | 'units' | 'scores'>('import');
  const [units, setUnits] = useState<any[]>([]);
  const [scores, setScores] = useState<any[]>([]);

  // 簡易的な管理者バリデーション
  const isAdmin = user?.email === 'kazuki2kr@gmail.com' || user?.email === 'ichikawa.kazuki@shibaurafzk.com';

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'units') fetchUnits();
    if (activeTab === 'scores') fetchScores();
  }, [activeTab, isAdmin]);

  const fetchUnits = async () => {
    setLoading(true);
    setMessage('');
    try {
      const snap = await getDocs(collection(db, 'units'));
      const arr: any[] = [];
      snap.forEach(d => arr.push(d.data()));
      setUnits(arr);
    } catch (e) {
      console.error(e);
      setMessage('単元の取得に失敗しました。');
    }
    setLoading(false);
  };

  const fetchScores = async () => {
    setLoading(true);
    setMessage('');
    try {
      const snap = await getDocs(collection(db, 'scores'));
      const arr: any[] = [];
      snap.forEach(d => arr.push({ docId: d.id, ...d.data() }));
      arr.sort((a,b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setScores(arr);
    } catch (e) {
      console.error(e);
      setMessage('得点の取得に失敗しました。');
    }
    setLoading(false);
  };

  const handleDeleteUnit = async (unitId: string) => {
    if (!window.confirm(`単元「${unitId}」を削除しますか？ 復元できません。`)) return;
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'units', unitId));
      setUnits(units.filter(u => u.id !== unitId));
      setMessage(`単元「${unitId}」を削除しました。`);
    } catch (e) {
      console.error(e);
      setMessage('削除エラーが発生しました。');
    }
    setLoading(false);
  };

  const handleDeleteQuestion = async (unitId: string, qId: string) => {
    if (!window.confirm(`問題を削除しますか？`)) return;
    setLoading(true);
    try {
      const unit = units.find(u => u.id === unitId);
      if (!unit) return;
      const newQuestions = unit.questions.filter((q:any) => q.id !== qId);
      await updateDoc(doc(db, 'units', unitId), { questions: newQuestions });
      setUnits(units.map(u => u.id === unitId ? { ...u, questions: newQuestions } : u));
      setMessage('問題を削除しました。');
    } catch (e) {
      console.error(e);
      setMessage('削除エラーが発生しました。');
    }
    setLoading(false);
  };

  const handleDeleteScore = async (docId: string) => {
    if (!window.confirm('この得点データを削除しますか？')) return;
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'scores', docId));
      setScores(scores.filter(s => s.docId !== docId));
      setMessage('得点データを削除しました。');
    } catch (e) {
      console.error(e);
      setMessage('削除エラーが発生しました。');
    }
    setLoading(false);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setMessage('CSVを解析中...');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const data = results.data as any[];
          setMessage(`解析完了. ${data.length}件のレコードを処理しています...`);

          const unitsMap: Record<string, any> = {};

          data.forEach((row, index) => {
            const { unit_id, question_text, options, answer_index, explanation, image_url } = row;
            if (!unit_id) return;

            if (!unitsMap[unit_id]) {
              unitsMap[unit_id] = { id: unit_id, title: `単元 ${unit_id}`, questions: [] };
            }

            let parsedOptions: string[] = [];
            try {
              parsedOptions = JSON.parse(options);
            } catch (e) {
              parsedOptions = typeof options === 'string' ? options.split(',').map(s => s.trim()) : [];
            }

            unitsMap[unit_id].questions.push({
              id: `q_${index}`,
              question_text: question_text || '',
              options: parsedOptions,
              answer_index: parseInt(answer_index) || 1,
              explanation: explanation || '',
              image_url: image_url || null,
            });
          });

          const batch = writeBatch(db);
          let count = 0;
          Object.values(unitsMap).forEach((unit) => {
            const unitRef = doc(db, 'units', unit.id);
            batch.set(unitRef, unit, { merge: true });
            count++;
          });

          await batch.commit();
          setMessage(`完了: ${count} 個の単元データをFirestoreに保存しました。`);
        } catch (err: any) {
          console.error("Firestore Upload Error", err);
          setMessage(`エラー: ${err.message}`);
        } finally {
          setLoading(false);
          event.target.value = '';
        }
      },
      error: (error) => {
        setMessage(`CSV解析エラー: ${error.message}`);
        setLoading(false);
      }
    });
  };

  if (!isAdmin && user) {
    return (
      <div className="p-8 text-center text-red-500 font-bold">
        管理者権限がありません。
      </div>
    );
  }

  const handleDownloadTemplate = () => {
    const csvContent = 
`unit_id,question_text,options,answer_index,explanation,image_url
unit_01,$1+1$は？,"[""1"",""2"",""3"",""4""]",2,1足す1は2です。,
unit_01,$x^2=4$ を解け,"[""x=2"",""x=-2"",""x=\\pm 2"",""解なし""]",3,平方根をとります。,
unit_02,次の図形の面積を求めよ,"[""10"",""20"",""30"",""40""]",2,底辺×高さ÷2です。,https://example.com/image.png
`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'math_app_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center space-x-3 mb-6">
        <Database className="w-8 h-8 text-primary" />
        <h2 className="text-2xl font-bold text-gray-800">管理者ダッシュボード</h2>
      </div>

      <div className="flex space-x-2 border-b">
        <button 
          onClick={() => setActiveTab('import')} 
          className={`px-4 py-2 font-medium ${activeTab === 'import' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <FileText className="inline w-4 h-4 mr-2" />
          CSVインポート
        </button>
        <button 
          onClick={() => setActiveTab('units')} 
          className={`px-4 py-2 font-medium ${activeTab === 'units' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Database className="inline w-4 h-4 mr-2" />
          単元・問題管理
        </button>
        <button 
          onClick={() => setActiveTab('scores')} 
          className={`px-4 py-2 font-medium ${activeTab === 'scores' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <UserCheck className="inline w-4 h-4 mr-2" />
          得点データ管理
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-md ${message.includes('エラー') ? 'bg-red-50 text-red-600' : 'bg-primary/10 text-primary'}`}>
          {message}
        </div>
      )}

      {/* ========== TAB: IMPORT ========== */}
      {activeTab === 'import' && (
        <Card className="border-t-4 border-t-primary shadow-sm mt-4">
          <CardHeader>
            <CardTitle>一括問題インポート (CSV)</CardTitle>
            <CardDescription>
              StudyAid等で作成したCSVデータをアップロードし、Firestoreへ一括登録します。同名の単元は上書きされます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <Input 
                type="file" 
                accept=".csv" 
                onChange={handleFileUpload} 
                disabled={loading}
                className="flex-1"
              />
              <Button variant="outline" onClick={handleDownloadTemplate} type="button">
                テンプレートをダウンロード
              </Button>
            </div>
            
            <div className="text-sm text-gray-500 bg-gray-50 p-4 rounded mt-4">
              <p className="font-semibold mb-2 text-gray-700">要求フォーマット</p>
              <ul className="list-disc list-inside space-y-2">
                <li>必須カラム: <code className="bg-white px-1 py-0.5 border rounded">unit_id</code>, <code className="bg-white px-1 py-0.5 border rounded">question_text</code>, <code className="bg-white px-1 py-0.5 border rounded">options</code>, <code className="bg-white px-1 py-0.5 border rounded">answer_index</code></li>
                <li><code className="bg-white px-1 py-0.5 border rounded">question_text</code> や解説はLaTeX記述（$数式$など）対応。</li>
                <li><code className="bg-white px-1 py-0.5 border rounded">options</code> は <code>["選択1", "選択2"]</code> のJSON形式を推奨（カンマ区切りも可）。</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ========== TAB: UNITS ========== */}
      {activeTab === 'units' && (
        <div className="space-y-6 mt-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">登録済みの単元数: {units.length}</p>
            <Button variant="outline" size="sm" onClick={fetchUnits} disabled={loading}>
              <RefreshCw className="w-4 h-4 mr-2" /> 再読み込み
            </Button>
          </div>
          
          {units.map(unit => (
            <Card key={unit.id} className="shadow-sm">
              <CardHeader className="bg-gray-50 border-b flex flex-row items-center justify-between py-4">
                <div>
                  <CardTitle className="text-lg text-primary">{unit.title} (ID: {unit.id})</CardTitle>
                  <CardDescription>問題数: {unit.questions?.length || 0}問</CardDescription>
                </div>
                <Button variant="destructive" size="sm" onClick={() => handleDeleteUnit(unit.id)}>
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
                    <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDeleteQuestion(unit.id, q.id)}>
                      削除
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ========== TAB: SCORES ========== */}
      {activeTab === 'scores' && (
        <div className="space-y-4 mt-4">
          <div className="flex justify-between items-center border-b pb-2">
             <p className="text-sm text-gray-500">総プレイデータ数: {scores.length}</p>
             <Button variant="outline" size="sm" onClick={fetchScores} disabled={loading}>
              <RefreshCw className="w-4 h-4 mr-2" /> 再読み込み
            </Button>
          </div>
          
          <div className="bg-white rounded-md shadow overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-600 border-b">
                <tr>
                  <th className="px-4 py-3">日時</th>
                  <th className="px-4 py-3">ユーザーID</th>
                  <th className="px-4 py-3">単元ID</th>
                  <th className="px-4 py-3">スコア</th>
                  <th className="px-4 py-3">時間</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y text-gray-600">
                {scores.map(s => (
                  <tr key={s.docId} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {s.createdAt ? new Date(s.createdAt.toMillis()).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-3">{s.userId}</td>
                    <td className="px-4 py-3 font-medium text-primary">{s.unitId}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-bold ${s.score >= 80 ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`}>
                        {s.score}点
                      </span>
                    </td>
                    <td className="px-4 py-3">{Math.floor(s.time / 60)}分{s.time % 60}秒</td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDeleteScore(s.docId)}>
                        データ削除
                      </Button>
                    </td>
                  </tr>
                ))}
                {scores.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">データがありません</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
