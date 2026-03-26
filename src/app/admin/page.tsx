'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection, getDocs, getDoc, deleteDoc, updateDoc, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Trash2, RefreshCw, FileText, Database, UserCheck, Shield, Zap, AlertTriangle, Save, X, BarChart, Users } from 'lucide-react';
import { MathDisplay } from '@/components/MathDisplay';
import { calculateLevelAndProgress, getTitleForLevel } from '@/lib/xp';
import { parseOptions } from '@/lib/utils';

export default function AdminPage() {
  const { user, isAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  const [activeTab, setActiveTab] = useState<'import' | 'units' | 'scores' | 'xp' | 'suspicious' | 'analytics' | 'roles'>('import');
  const [units, setUnits] = useState<any[]>([]);
  const [scores, setScores] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [editingXp, setEditingXp] = useState<Record<string, string>>({});
  const [suspiciousFilter, setSuspiciousFilter] = useState<'red' | 'yellow' | 'all'>('red');
  
  // Analytics
  const [selectedUnitForStats, setSelectedUnitForStats] = useState<string>('');
  const [unitStats, setUnitStats] = useState<any>(null);

  const [importSubject, setImportSubject] = useState<string>('math');
  const [unitFilterSubject, setUnitFilterSubject] = useState<string>('all');
  const [unitFilterCategory, setUnitFilterCategory] = useState<string>('all');
  
  const [correlationMatrix, setCorrelationMatrix] = useState<number[][] | null>(null);
  const [isComputingCorrelation, setIsComputingCorrelation] = useState(false);

  // Role management state
  const [roleEmail, setRoleEmail] = useState('');
  const [roleLoading, setRoleLoading] = useState(false);
  const [adminList, setAdminList] = useState<Array<{ uid: string; email: string; displayName: string }>>([]);
  const [adminListLoading, setAdminListLoading] = useState(false);

  // Custom Claims ベース管理者チェック（AuthContext から取得）

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'units' || activeTab === 'analytics') fetchUnits();
    if (activeTab === 'scores') fetchScores();
    if (activeTab === 'xp') fetchUsers();
    if (activeTab === 'suspicious') { fetchScores(); }
    if (activeTab === 'roles') { fetchAdminList(); }
  }, [activeTab, isAdmin]);

  const fetchAdminList = async () => {
    setAdminListLoading(true);
    try {
      const functions = getFunctions(undefined, 'us-central1');
      const listAdminsFn = httpsCallable(functions, 'listAdmins');
      const result: any = await listAdminsFn({});
      setAdminList(result.data.admins || []);
    } catch (err: any) {
      console.error('Failed to fetch admin list:', err);
      setMessage(`管理者一覧取得エラー: ${err.message}`);
    } finally {
      setAdminListLoading(false);
    }
  };

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

  const fetchUnitStats = async (unitId: string) => {
    if (!unitId) {
      setUnitStats(null); return;
    }
    setLoading(true);
    setMessage('');
    try {
      const snap = await getDoc(doc(db, 'units', unitId, 'stats', 'questions'));
      if (snap.exists()) {
         const data = snap.data();
         console.log(`[fetchUnitStats] Data for ${unitId}:`, data);
         setUnitStats(data);
      } else {
         console.log(`[fetchUnitStats] No stats document for ${unitId} at units/${unitId}/stats/questions`);
         setUnitStats({});
         setMessage('この単元の詳細な統計データはまだありません。');
      }
    } catch (e) {
      console.error(e);
      setMessage('統計データの取得に失敗しました。');
    }
    setLoading(false);
  };

  const calculatePhi = (v1: number[], v2: number[]) => {
     let n11 = 0, n10 = 0, n01 = 0, n00 = 0;
     for (let i = 0; i < v1.length; i++) {
        if (v1[i] === 1 && v2[i] === 1) n11++;
        else if (v1[i] === 1 && v2[i] === 0) n10++;
        else if (v1[i] === 0 && v2[i] === 1) n01++;
        else n00++;
     }
     const num = (n11 * n00) - (n10 * n01);
     const denom = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00));
     return denom === 0 ? 0 : num / denom;
  };

  const computeCorrelation = async (unitId: string) => {
    setIsComputingCorrelation(true);
    setCorrelationMatrix(null);
    setMessage('全ユーザーのプレイデータを取得中...');
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const allAttempts: any[] = [];
      for (const u of usersSnap.docs) {
         const userAttemptsSnap = await getDocs(collection(db, 'users', u.id, 'attempts'));
         userAttemptsSnap.forEach(d => {
            const data = d.data();
            if (data.unitId === unitId) {
               allAttempts.push(data);
            }
         });
      }
      
      if (allAttempts.length < 2) {
         setMessage('相関分析を行うためのデータが不足しています（最低2件のプレイデータが必要です）。');
         setCorrelationMatrix(null);
         setIsComputingCorrelation(false);
         return;
      }

      setMessage('相関行列を計算中...');
      const selectedUnitData = units.find(u => u.id === unitId);
      if (!selectedUnitData) return;
      const questionIds = selectedUnitData.questions.map((q:any) => q.id);
      
      const n = questionIds.length;
      const matrix = Array.from({length: n}, () => Array(n).fill(0));

      const qVectors: Record<string, number[]> = {};
      questionIds.forEach((qid:string) => { qVectors[qid] = []; });
      
      allAttempts.forEach(attempt => {
         const map = new Map<string, boolean>();
         attempt.details?.forEach((d:any) => map.set(d.qId, d.isCorrect));
         
         questionIds.forEach((qid:string) => {
            if (map.has(qid)) {
               qVectors[qid].push(map.get(qid) ? 1 : 0);
            } else {
               qVectors[qid].push(0);
            }
         });
      });

      for (let i = 0; i < n; i++) {
         for (let j = 0; j < n; j++) {
            if (i === j) {
               matrix[i][j] = 1.0;
            } else if (i < j) {
               const v1 = qVectors[questionIds[i]];
               const v2 = qVectors[questionIds[j]];
               matrix[i][j] = calculatePhi(v1, v2);
               matrix[j][i] = matrix[i][j];
            }
         }
      }
      setCorrelationMatrix(matrix);
      setMessage(`計算完了！全 ${allAttempts.length} 件のプレイデータから相関行列を生成しました。`);
    } catch (e) {
      console.error(e);
      setMessage('相関計算に失敗しました。');
    }
    setIsComputingCorrelation(false);
  };

  const fetchScores = async () => {
    setLoading(true);
    setMessage('');
    try {
      const snap = await getDocs(collection(db, 'scores'));
      const arr: any[] = [];
      snap.forEach(d => arr.push({ docId: d.id, ...d.data() }));
      arr.sort((a,b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : (a.createdAt?.toMillis?.() || 0);
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : (b.createdAt?.toMillis?.() || 0);
        return timeB - timeA;
      });
      setScores(arr);
    } catch (e) {
      console.error(e);
      setMessage('得点の取得に失敗しました。');
    }
    setLoading(false);
  };

  const fetchUsers = async () => {
    setLoading(true);
    setMessage('');
    try {
      const snap = await getDocs(collection(db, 'users'));
      const arr: any[] = [];
      snap.forEach(d => arr.push({ docId: d.id, ...d.data() }));
      arr.sort((a, b) => (b.xp || 0) - (a.xp || 0));
      setUsers(arr);
    } catch (e) {
      console.error(e);
      setMessage('ユーザー情報の取得に失敗しました。');
    }
    setLoading(false);
  };

  const handleUpdateXp = async (uid: string, newXpStr: string) => {
    const newXp = parseInt(newXpStr);
    if (isNaN(newXp) || newXp < 0) {
      setMessage('エラー: XPは0以上の数値を入力してください。');
      return;
    }
    setLoading(true);
    try {
      await setDoc(doc(db, 'users', uid), { xp: newXp }, { merge: true });
      setUsers(users.map(u => u.docId === uid ? { ...u, xp: newXp } : u));
      setEditingXp(prev => { const n = { ...prev }; delete n[uid]; return n; });
      setMessage(`XPを${newXp}に更新しました。`);
    } catch (e) {
      console.error(e);
      setMessage('XP更新エラーが発生しました。');
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

  const handleIgnoreFraud = async (docId: string) => {
    if (!window.confirm('この記録を問題なしとして非表示にしますか？')) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'scores', docId), { ignoreFraud: true });
      setScores(scores.map(s => s.docId === docId ? { ...s, ignoreFraud: true } : s));
      setMessage('記録を問題なしとして処理しました。');
    } catch (e) {
      console.error(e);
      setMessage('更新エラーが発生しました。');
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
            const { unit_id, question_text, options, answer_index, explanation, image_url, category } = row;
            if (!unit_id) return;

            if (!unitsMap[unit_id]) {
              unitsMap[unit_id] = { 
                id: unit_id, 
                title: `単元 ${unit_id}`, 
                questions: [],
                subject: importSubject === 'math' ? '数学' : importSubject === 'english' ? '英語' : importSubject,
                category: category || '1.正の数と負の数'
              };
            }

            unitsMap[unit_id].questions.push({
              id: `q_${index}`,
              question_text: question_text || '',
              options: parseOptions(options),
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
`unit_id,category,question_text,options,answer_index,explanation,image_url
unit_01,1.正の数と負の数,$1+1$は？,"[""1"",""2"",""3"",""4""]",2,1足す1は2です。,
unit_01,1.正の数と負の数,$x^2=4$ を解け,"[""x=2"",""x=-2"",""x=\\pm 2"",""解なし""]",3,平方根をとります。,
unit_02,2.文字の式,次の図形の面積を求めよ,"[""10"",""20"",""30"",""40""]",2,底辺×高さ÷2です。,https://example.com/image.png
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
        <button 
          onClick={() => setActiveTab('xp')} 
          className={`px-4 py-2 font-medium ${activeTab === 'xp' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Zap className="inline w-4 h-4 mr-2" />
          経験値管理
        </button>
        <button 
          onClick={() => setActiveTab('suspicious')} 
          className={`px-4 py-2 font-medium ${activeTab === 'suspicious' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Shield className="inline w-4 h-4 mr-2" />
          不正疑惑
        </button>
        <button 
          onClick={() => setActiveTab('analytics')} 
          className={`px-4 py-2 font-medium ${activeTab === 'analytics' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <BarChart className="inline w-4 h-4 mr-2" />
          統計・分析
        </button>
        <button 
          onClick={() => setActiveTab('roles')} 
          className={`px-4 py-2 font-medium ${activeTab === 'roles' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Users className="inline w-4 h-4 mr-2" />
          管理者ロール
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
            <div className="flex flex-col gap-2 mb-4 bg-gray-50 border p-4 rounded-xl">
              <label className="text-sm font-bold text-gray-700 flex items-center">
                <Database className="w-4 h-4 mr-1" />
                対象教科の選択
              </label>
              <select 
                value={importSubject} 
                onChange={(e) => setImportSubject(e.target.value)}
                className="text-sm border border-gray-300 rounded-md px-3 py-2 bg-white font-medium focus:border-primary outline-none"
              >
                <option value="math">数学</option>
                <option value="english">英語</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                ※アップロードするCSVデータすべてにこの教科が設定されます。
              </p>
            </div>

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
                <li>任意カラム: <code className="bg-white px-1 py-0.5 border rounded">category</code> (分野。空の場合は「1.正の数と負の数」として登録されます)</li>
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
                表示中: {
                  units.filter(u => {
                    const sMatch = unitFilterSubject === 'all' || u.subject === unitFilterSubject;
                    const cMatch = unitFilterCategory === 'all' || (u.category || 'その他') === unitFilterCategory;
                    return sMatch && cMatch;
                  }).length
                } / {units.length} 単元
              </p>
              <Button variant="outline" size="sm" onClick={fetchUnits} disabled={loading}>
                <RefreshCw className="w-4 h-4 mr-2" /> 再読み込み
              </Button>
            </div>
          </div>
          
          {units
            .filter(u => {
              const sMatch = unitFilterSubject === 'all' || u.subject === unitFilterSubject;
              const cMatch = unitFilterCategory === 'all' || (u.category || 'その他') === unitFilterCategory;
              return sMatch && cMatch;
            })
            .map(unit => (
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
                  <th className="px-4 py-3">ユーザー名</th>
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
                      {s.updatedAt 
                        ? new Date(s.updatedAt).toLocaleString() 
                        : (s.createdAt?.toDate 
                            ? s.createdAt.toDate().toLocaleString() 
                            : (typeof s.createdAt === 'string' || typeof s.createdAt === 'number' 
                                ? new Date(s.createdAt).toLocaleString() 
                                : '-'))}
                    </td>
                    <td className="px-4 py-3">{s.userName || s.uid || s.userId || '-'}</td>
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

      {/* ========== TAB: XP MANAGEMENT ========== */}
      {activeTab === 'xp' && (
        <div className="space-y-4 mt-4">
          <div className="flex justify-between items-center border-b pb-2">
            <p className="text-sm text-gray-500">登録ユーザー数: {users.length}</p>
            <Button variant="outline" size="sm" onClick={fetchUsers} disabled={loading}>
              <RefreshCw className="w-4 h-4 mr-2" /> 再読み込み
            </Button>
          </div>
          
          <div className="bg-white rounded-md shadow overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-600 border-b">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">ユーザー名</th>
                  <th className="px-4 py-3">メール</th>
                  <th className="px-4 py-3">Lv</th>
                  <th className="px-4 py-3">称号</th>
                  <th className="px-4 py-3">XP</th>
                  <th className="px-4 py-3">アイコン</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y text-gray-600">
                {users.map((u, idx) => {
                  const lvData = calculateLevelAndProgress(u.xp || 0);
                  const title = getTitleForLevel(lvData.level);
                  const isEditing = editingXp[u.docId] !== undefined;
                  return (
                    <tr key={u.docId} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-gray-400 font-mono">{idx + 1}</td>
                      <td className="px-4 py-3 font-medium">{u.displayName || '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{u.email || '-'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                          Lv.{lvData.level}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-amber-700">{title}</td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <Input
                            type="number"
                            min="0"
                            value={editingXp[u.docId]}
                            onChange={(e) => setEditingXp(prev => ({ ...prev, [u.docId]: e.target.value }))}
                            className="w-24 h-8 text-sm"
                          />
                        ) : (
                          <span className="font-mono font-bold text-primary">{u.xp?.toLocaleString() || 0}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-2xl">{u.icon || '📐'}</td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="text-green-600 hover:text-green-800 hover:bg-green-50" onClick={() => handleUpdateXp(u.docId, editingXp[u.docId])}>
                              <Save className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-gray-500 hover:text-gray-700" onClick={() => setEditingXp(prev => { const n = { ...prev }; delete n[u.docId]; return n; })}>
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <Button variant="ghost" size="sm" className="text-blue-500 hover:text-blue-700 hover:bg-blue-50" onClick={() => setEditingXp(prev => ({ ...prev, [u.docId]: String(u.xp || 0) }))}>
                            編集
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">ユーザーデータがありません</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========== TAB: SUSPICIOUS USERS ========== */}
      {activeTab === 'suspicious' && (
        <div className="space-y-4 mt-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b pb-3">
            <div>
              <p className="text-sm text-gray-500">不正疑惑ユーザー検出</p>
              <p className="text-xs text-gray-400">1問あたりの平均解答時間が異常に短いデータを検出します</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={suspiciousFilter}
                onChange={(e) => setSuspiciousFilter(e.target.value as any)}
                className="text-sm border rounded-md px-3 py-1.5 bg-white"
              >
                <option value="red">🚨 赤フラグのみ（≤3秒/問）</option>
                <option value="yellow">⚠️ 黄+赤フラグ（≤5秒/問）</option>
                <option value="all">全件表示</option>
              </select>
              <Button variant="outline" size="sm" onClick={fetchScores} disabled={loading}>
                <RefreshCw className="w-4 h-4 mr-2" /> 再読み込み
              </Button>
            </div>
          </div>

          {(() => {
            const QUESTIONS_PER_DRILL = 10;
            const analyzed = scores
              .filter(s => s.bestTime != null && s.bestTime > 0 && !s.ignoreFraud)
              .map(s => {
                const avgPerQ = s.bestTime / QUESTIONS_PER_DRILL;
                let flag: 'red' | 'yellow' | 'green' = 'green';
                if (avgPerQ <= 3) flag = 'red';
                else if (avgPerQ <= 5) flag = 'yellow';
                return { ...s, avgPerQ, flag };
              })
              .sort((a, b) => a.avgPerQ - b.avgPerQ);

            const filtered = suspiciousFilter === 'all'
              ? analyzed
              : suspiciousFilter === 'yellow'
                ? analyzed.filter(s => s.flag === 'red' || s.flag === 'yellow')
                : analyzed.filter(s => s.flag === 'red');

            const redCount = analyzed.filter(s => s.flag === 'red').length;
            const yellowCount = analyzed.filter(s => s.flag === 'yellow').length;

            return (
              <>
                <div className="flex gap-4 text-sm">
                  <div className="flex items-center gap-1.5 bg-red-50 text-red-700 px-3 py-1.5 rounded-lg border border-red-200">
                    <AlertTriangle className="w-4 h-4" /> 赤フラグ: {redCount}件
                  </div>
                  <div className="flex items-center gap-1.5 bg-yellow-50 text-yellow-700 px-3 py-1.5 rounded-lg border border-yellow-200">
                    <AlertTriangle className="w-4 h-4" /> 黄フラグ: {yellowCount}件
                  </div>
                </div>

                <div className="bg-white rounded-md shadow overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-600 border-b">
                      <tr>
                        <th className="px-4 py-3">判定</th>
                        <th className="px-4 py-3">ユーザー名</th>
                        <th className="px-4 py-3">単元</th>
                        <th className="px-4 py-3">スコア</th>
                        <th className="px-4 py-3">合計時間</th>
                        <th className="px-4 py-3">1問あたり</th>
                        <th className="px-4 py-3">日時</th>
                        <th className="px-4 py-3 text-center">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-gray-600">
                      {filtered.map(s => (
                        <tr key={s.docId} className={`hover:bg-gray-50/50 ${s.flag === 'red' ? 'bg-red-50/40' : s.flag === 'yellow' ? 'bg-yellow-50/40' : ''}`}>
                          <td className="px-4 py-3 text-center text-lg">
                            {s.flag === 'red' ? '🚨' : s.flag === 'yellow' ? '⚠️' : '✅'}
                          </td>
                          <td className="px-4 py-3 font-medium">{s.userName || s.uid || '-'}</td>
                          <td className="px-4 py-3 text-primary font-medium">{s.unitId}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-bold ${(s.maxScore ?? 0) >= 80 ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`}>
                              {s.maxScore ?? '-'}点
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono">{s.bestTime}秒</td>
                          <td className="px-4 py-3">
                            <span className={`font-bold font-mono ${
                              s.flag === 'red' ? 'text-red-600' : s.flag === 'yellow' ? 'text-yellow-600' : 'text-gray-600'
                            }`}>
                              {s.avgPerQ.toFixed(1)}秒/問
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                            {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 justify-center">
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-green-600 hover:text-green-700 hover:bg-green-50 text-xs px-2 py-1 h-auto"
                                onClick={() => handleIgnoreFraud(s.docId)}
                              >
                                <UserCheck className="w-3 h-3 mr-1" /> 問題なし
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 text-xs px-2 py-1 h-auto"
                                onClick={() => handleDeleteScore(s.docId)}
                              >
                                <Trash2 className="w-3 h-3 " /> 削除
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                            {suspiciousFilter === 'all' ? 'データがありません' : '該当する不正疑惑データはありません ✅'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ========== TAB: ANALYTICS ========== */}
      {activeTab === 'analytics' && (
        <div className="space-y-6 mt-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center bg-gray-50 p-4 border rounded-md">
            <h3 className="font-bold text-gray-700 whitespace-nowrap">分析対象の単元を選択:</h3>
            <select 
              className="flex-1 p-2 border rounded-md bg-white"
              value={selectedUnitForStats}
              onChange={(e) => {
                setSelectedUnitForStats(e.target.value);
                fetchUnitStats(e.target.value);
              }}
            >
              <option value="">-- 単元を選択 --</option>
              {units.map(u => (
                <option key={u.id} value={u.id}>{u.title} ({u.id})</option>
              ))}
            </select>
            <Button disabled={!selectedUnitForStats || loading} onClick={() => fetchUnitStats(selectedUnitForStats)}>
              <RefreshCw className="w-4 h-4 mr-2" />
              データを再取得
            </Button>
          </div>

          {selectedUnitForStats && unitStats && Object.keys(unitStats).length > 0 && (
            <div className="space-y-6">
              {(() => {
                // Compile rates
                const selectedUnitData = units.find(u => u.id === selectedUnitForStats);
                if (!selectedUnitData) return null;

                const qStatsList = selectedUnitData.questions.map((q: any) => {
                  const qId = q.id.toString();
                  const key1 = qId;
                  const key2 = `q_${qId}`;
                  
                  // Firestore might store nested: { q_1: { total: 1 } }
                  // OR flat with dot: { "q_1.total": 1 }
                  let stat = unitStats[key1] || unitStats[key2];
                  
                  // If not found in primary keys, try flat dot-notation from object
                  if (!stat) {
                    const totalFromFlat = unitStats[`${key1}.total`] || unitStats[`${key2}.total`];
                    if (totalFromFlat !== undefined) {
                      stat = {
                        total: totalFromFlat,
                        correct: unitStats[`${key1}.correct`] || unitStats[`${key2}.correct`] || 0
                      };
                    }
                  }

                  if (stat) {
                    console.log(`[MappingSuccess] QID: ${qId} matched.`, stat);
                  }
                  
                  const total = stat?.total || 0;
                  const correct = stat?.correct || 0;
                  const rate = total > 0 ? (correct / total) * 100 : 0;
                  return { ...q, total, correct, rate };
                });

                const attemptedQStatsList = qStatsList.filter((q: any) => q.total > 0);
                console.log(`[AnalyticsTabDebug] unitId=${selectedUnitForStats}`, {
                  totalQuestions: selectedUnitData.questions.length,
                  attemptedCount: attemptedQStatsList.length,
                  availableStatsKeys: Object.keys(unitStats)
                });

                if (attemptedQStatsList.length === 0) {
                  return (
                    <div className="text-gray-500 p-12 text-center bg-white rounded-xl border border-dashed shadow-sm flex flex-col items-center justify-center space-y-4">
                      <BarChart className="w-12 h-12 text-gray-300" />
                      <div>
                        <p className="font-bold text-gray-600">まだ回答データが十分ではありません</p>
                        <p className="text-sm">少なくとも1回以上、この単元の演習が完了すると統計が表示されます。</p>
                      </div>
                    </div>
                  );
                }

                const sortedByRateData = [...qStatsList].sort((a, b) => b.rate - a.rate);
                const top5 = sortedByRateData.slice(0, 5);
                const worst5 = [...qStatsList].sort((a, b) => a.rate - b.rate).slice(0, 5);

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Top 5 Card */}
                    <Card className="shadow-md border-t-4 border-t-green-500">
                      <CardHeader>
                        <CardTitle className="text-green-700">よくできている問題 Top 5</CardTitle>
                        <CardDescription>正答率が高い順</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {top5.map((q, idx) => (
                          <div key={idx} className="bg-green-50 p-3 rounded-md border border-green-100 flex gap-4 items-center">
                            <div className="w-12 h-12 bg-green-200 text-green-800 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                              {Math.round(q.rate)}%
                            </div>
                            <div className="flex-1 overflow-hidden">
                              <p className="text-xs text-gray-500 mb-1">
                                {q.correct} / {q.total} 回正解
                              </p>
                              <div className="text-sm line-clamp-2 overflow-hidden text-ellipsis h-[3em]">
                                <MathDisplay math={q.question_text} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    {/* Worst 5 Card */}
                    <Card className="shadow-md border-t-4 border-t-red-500">
                      <CardHeader>
                        <CardTitle className="text-red-700">間違いが多い問題 Worst 5</CardTitle>
                        <CardDescription>正答率が低い順</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {worst5.map((q, idx) => (
                          <div key={idx} className="bg-red-50 p-3 rounded-md border border-red-100 flex gap-4 items-center">
                            <div className="w-12 h-12 bg-red-200 text-red-800 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0">
                              {Math.round(q.rate)}%
                            </div>
                            <div className="flex-1 overflow-hidden">
                              <p className="text-xs text-gray-500 mb-1">
                                {q.total - q.correct} / {q.total} 回不正解
                              </p>
                              <div className="text-sm line-clamp-2 overflow-hidden text-ellipsis h-[3em]">
                                <MathDisplay math={q.question_text} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    {/* Correlation Matrix Card */}
                    <Card className="shadow-md lg:col-span-2 border-t-4 border-t-blue-500 mt-4">
                      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
                        <div>
                          <CardTitle className="text-blue-700">問題間の相関分析 (ローカル計算)</CardTitle>
                          <CardDescription className="max-w-xl">問題間の正誤の相関係数（Phi係数）を算出しヒートマップで表示します。ある問題を間違えた生徒が別の問題も間違えやすい等の傾向分析に利用できます。</CardDescription>
                        </div>
                        <Button onClick={() => computeCorrelation(selectedUnitForStats)} disabled={isComputingCorrelation}>
                           {isComputingCorrelation ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <BarChart className="w-4 h-4 mr-2" />}
                           相関を計算する
                        </Button>
                      </CardHeader>
                      <CardContent>
                        {correlationMatrix && (
                           <div className="overflow-x-auto pb-4">
                              <table className="w-full text-xs text-center border-collapse min-w-max">
                                <thead>
                                  <tr>
                                    <th className="p-2 border bg-gray-50 uppercase tracking-widest text-muted-foreground w-12 sticky left-0 z-10">Q</th>
                                    {selectedUnitData.questions.map((q:any, i:number) => (
                                       <th key={i} className="p-2 border bg-gray-50 min-w-[3rem]" title={q.question_text}>Q{i+1}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedUnitData.questions.map((q:any, i:number) => (
                                     <tr key={i}>
                                        <th className="p-2 border bg-gray-50 text-left truncate max-w-[100px] sticky left-0 z-10" title={q.question_text}>
                                          <div className="flex items-center gap-2">
                                            <span className="font-bold">Q{i+1}</span>
                                          </div>
                                        </th>
                                        {selectedUnitData.questions.map((_: any, j:number) => {
                                           const val = correlationMatrix[i][j];
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
                                              <td key={j} className="p-2 border font-mono font-medium" style={{ backgroundColor: bg, color: textColor }}>
                                                {val === 0 ? '0.00' : val.toFixed(2)}
                                              </td>
                                           );
                                        })}
                                     </tr>
                                  ))}
                                </tbody>
                              </table>
                           </div>
                        )}
                      </CardContent>
                    </Card>

                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}


      {/* ========== TAB: ROLES ========== */}
      {activeTab === 'roles' && (
        <div className="space-y-6 mt-4">
          <Card className="shadow-sm">
            <CardHeader className="bg-gray-50 border-b">
              <CardTitle className="text-lg text-primary flex items-center gap-2">
                <Shield className="w-5 h-5" /> 管理者権限の管理
              </CardTitle>
              <CardDescription>Custom Claims を使用して管理者権限を付与・剥奪します。</CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                <AlertTriangle className="inline w-4 h-4 mr-1" />
                管理者権限を付与されたユーザーは、全生徒のデータ閲覧・編集・削除が可能になります。慎重に操作してください。
              </div>
              <div className="flex gap-3">
                <Input
                  type="email"
                  placeholder="管理者に追加するメールアドレス"
                  value={roleEmail}
                  onChange={(e) => setRoleEmail(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={async () => {
                    if (!roleEmail) return;
                    setRoleLoading(true);
                    setMessage('');
                    try {
                      const functions = getFunctions(undefined, 'us-central1');
                      const setAdminClaim = httpsCallable(functions, 'setAdminClaim');
                      const result: any = await setAdminClaim({ email: roleEmail, isAdmin: true });
                      setMessage(`✅ ${result.data.message}`);
                      setRoleEmail('');
                      fetchAdminList();
                    } catch (err: any) {
                      setMessage(`エラー: ${err.message}`);
                    } finally {
                      setRoleLoading(false);
                    }
                  }}
                  disabled={roleLoading || !roleEmail}
                  className="bg-primary"
                >
                  <Shield className="w-4 h-4 mr-2" /> 権限付与
                </Button>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    if (!roleEmail) return;
                    setRoleLoading(true);
                    setMessage('');
                    try {
                      const functions = getFunctions(undefined, 'us-central1');
                      const setAdminClaim = httpsCallable(functions, 'setAdminClaim');
                      const result: any = await setAdminClaim({ email: roleEmail, isAdmin: false });
                      setMessage(`✅ ${result.data.message}`);
                      setRoleEmail('');
                      fetchAdminList();
                    } catch (err: any) {
                      setMessage(`エラー: ${err.message}`);
                    } finally {
                      setRoleLoading(false);
                    }
                  }}
                  disabled={roleLoading || !roleEmail}
                >
                  <X className="w-4 h-4 mr-2" /> 権限剥奪
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">※ 権限変更後、対象ユーザーが次回ログインした際に反映されます。</p>
            </CardContent>
          </Card>

          {/* 管理者一覧 */}
          <Card className="shadow-sm">
            <CardHeader className="bg-gray-50 border-b flex flex-row items-center justify-between py-4">
              <div>
                <CardTitle className="text-lg text-primary flex items-center gap-2">
                  <Users className="w-5 h-5" /> 登録済み管理者一覧
                </CardTitle>
                <CardDescription>admin Custom Claim が付与されているユーザー</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={fetchAdminList} disabled={adminListLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${adminListLoading ? 'animate-spin' : ''}`} /> 更新
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {adminListLoading ? (
                <div className="flex justify-center p-8">
                  <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full"></div>
                </div>
              ) : adminList.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">管理者が見つかりません。</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left p-3 font-semibold text-gray-600">名前</th>
                      <th className="text-left p-3 font-semibold text-gray-600">メールアドレス</th>
                      <th className="text-left p-3 font-semibold text-gray-600">UID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminList.map((a) => (
                      <tr key={a.uid} className="border-b hover:bg-gray-50 transition-colors">
                        <td className="p-3 font-medium">{a.displayName}</td>
                        <td className="p-3 text-muted-foreground">{a.email}</td>
                        <td className="p-3 font-mono text-xs text-muted-foreground">{a.uid.slice(0, 12)}...</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  );
}
