'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection, getDocs, getDoc, deleteDoc, updateDoc, setDoc, query, orderBy, limit, collectionGroup, startAfter, increment } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Trash2, RefreshCw, FileText, Database, UserCheck, Shield, Zap, AlertTriangle, Save, X, BarChart, Users, Upload, Package, History } from 'lucide-react';
import { MathDisplay } from '@/components/MathDisplay';
import { calculateLevelAndProgress, getTitleForLevel } from '@/lib/xp';
import { parseOptions } from '@/lib/utils';
import AnalyticsTab from './components/AnalyticsTab';
import { VersionHistoryPanel } from './components/VersionHistoryPanel';
import 'katex/dist/katex.min.css';

export default function AdminPage() {
  const { user, isAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  const [activeTab, setActiveTab] = useState<'import' | 'units' | 'scores' | 'xp' | 'suspicious' | 'analytics' | 'roles' | 'changelog'>('roles');
  const [units, setUnits] = useState<any[]>([]);
  const [scores, setScores] = useState<any[]>([]); // holds attempts now
  const [lastAttemptDoc, setLastAttemptDoc] = useState<any>(null);
  const [hasMoreAttempts, setHasMoreAttempts] = useState(true);
  const [suspiciousActivities, setSuspiciousActivities] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [editingXp, setEditingXp] = useState<Record<string, string>>({});
  const [suspiciousFilter, setSuspiciousFilter] = useState<'red' | 'yellow' | 'all'>('red');
  const [displayScoresCount, setDisplayScoresCount] = useState(50);
  const [displayUsersCount, setDisplayUsersCount] = useState(50);
  const [displaySuspiciousCount, setDisplaySuspiciousCount] = useState(30);
  const [selectedScoreIds, setSelectedScoreIds] = useState<Set<string>>(new Set());
  
  // Analytics
  const [selectedUnitForStats, setSelectedUnitForStats] = useState<string>('');
  const [globalStats, setGlobalStats] = useState<any>(null);

  const [importSubject, setImportSubject] = useState<string>('math');
  const [unitFilterSubject, setUnitFilterSubject] = useState<string>('all');
  const [unitFilterCategory, setUnitFilterCategory] = useState<string>('all');

  // Role management state
  const [roleEmail, setRoleEmail] = useState('');
  const [roleLoading, setRoleLoading] = useState(false);
  const [adminList, setAdminList] = useState<Array<{ uid: string; email: string; displayName: string }>>([]);
  const [adminListLoading, setAdminListLoading] = useState(false);

  // Custom Claims ベース管理者チェック（AuthContext から取得）

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'units' || activeTab === 'analytics') fetchUnits();
    if (activeTab === 'scores' || activeTab === 'suspicious' || activeTab === 'analytics') fetchScores();
    if (activeTab === 'xp') fetchUsers();
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
    if (!isAdmin) return;
    setLoading(true);
    setMessage('');
    try {
      const snap = await getDocs(collection(db, 'units'));
      const unitsArray = snap.docs.map(d => d.data());
      
      // stats/questions ドキュメントを一括取得 (collectionGroupを使用)
      // IDが 'questions' のドキュメントのみを対象とする
      const statsSnap = await getDocs(query(collectionGroup(db, 'stats')));
      const statsMap: Record<string, any> = {};
      
      statsSnap.forEach(sDoc => {
        if (sDoc.id === 'questions') {
          // パスから unitId を抽出: units/{unitId}/stats/questions
          const pathParts = sDoc.ref.path.split('/');
          const unitId = pathParts[1];
          statsMap[unitId] = sDoc.data();
        }
      });

      // stats/global を取得（総プレイ回数など）
      try {
        const globalStatsDoc = await getDoc(doc(db, 'stats', 'global'));
        if (globalStatsDoc.exists()) {
          setGlobalStats(globalStatsDoc.data());
        }
      } catch {
        console.warn('stats/global の取得に失敗しました');
      }

      const arr = await Promise.all(unitsArray.map(async unit => {
        // 各単元の問題をサブコレクションから取得
        const qSnap = await getDocs(collection(db, 'units', unit.id, 'questions'));
        const questions = qSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return {
          ...unit,
          questions,
          stats: statsMap[unit.id] || null
        };
      }));

      setUnits(arr);
    } catch (e) {
      console.error(e);
      setMessage('単元の取得に失敗しました。');
    }
    setLoading(false);
  };

  // NOTE: fetchUnitStats, calculatePhi, computeCorrelation は
  // AnalyticsTab / SmartCorrelationPanel に移動済み

  const fetchScores = async (loadMore = false) => {
    if (!isAdmin) return;
    setLoading(true);
    setMessage('');
    try {
      let attemptQuery = query(
        collectionGroup(db, 'attempts'),
        orderBy('date', 'desc'),
        limit(50)
      );

      if (loadMore && lastAttemptDoc) {
        attemptQuery = query(
          collectionGroup(db, 'attempts'),
          orderBy('date', 'desc'),
          startAfter(lastAttemptDoc),
          limit(50)
        );
      }

      const snap = await getDocs(attemptQuery);
      if (snap.empty) {
        setHasMoreAttempts(false);
      } else {
        setLastAttemptDoc(snap.docs[snap.docs.length - 1]);
        const arr: any[] = loadMore ? [...scores] : [];
        snap.forEach(d => {
          const data = d.data();
          if (data) {
            arr.push({ docId: d.id, path: d.ref.path, ...data });
          }
        });
        setScores(arr);
        if (snap.docs.length < 50) setHasMoreAttempts(false);
        else setHasMoreAttempts(true);
      }

      if (!loadMore) {
        try {
          const suspiciousSnap = await getDocs(query(collection(db, 'suspicious_activities'), orderBy('timestamp', 'desc'), limit(100)));
          const sArr: any[] = [];
          suspiciousSnap.forEach(d => sArr.push({ id: d.id, ...d.data() }));
          setSuspiciousActivities(sArr);
        } catch (err: any) {
          console.warn('Suspicious activities could not be fetched:', err);
        }
      }
    } catch (e: any) {
      console.error(e);
      setMessage('得点の取得に失敗しました。');
    }
    setLoading(false);
  };

  const fetchUsers = async () => {
    if (!isAdmin) return;
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
      // サブコレクションからドキュメントを削除
      await deleteDoc(doc(db, 'units', unitId, 'questions', qId));
      
      // 単元の totalQuestions をデクリメント
      const unitRef = doc(db, 'units', unitId);
      const unit = units.find(u => u.id === unitId);
      const newTotal = Math.max(0, (unit?.totalQuestions || 0) - 1);
      await updateDoc(unitRef, { totalQuestions: newTotal });
      
      // ローカルステートを更新
      setUnits(units.map(u => 
        u.id === unitId 
          ? { ...u, totalQuestions: newTotal, questions: u.questions.filter((q: any) => q.id !== qId) } 
          : u
      ));
      
      setMessage('問題を削除しました。');
    } catch (e) {
      console.error(e);
      setMessage('削除エラーが発生しました。');
    }
    setLoading(false);
  };

  // --- Stats デクリメント（Attempt削除時にstatsカウンターを連動） ---
  const decrementStatsForAttempts = async (attempts: any[]) => {
    // unitId ごとに集計
    const unitDecrements: Record<string, { totalDec: number; correctDec: number; perQuestion: Record<string, { total: number; correct: number }> }> = {};
    let globalDrillsDec = 0;
    let globalCorrectDec = 0;
    let globalAnsweredDec = 0;

    for (const att of attempts) {
      if (!att.unitId || !att.details || !Array.isArray(att.details)) continue;
      if (!unitDecrements[att.unitId]) {
        unitDecrements[att.unitId] = { totalDec: 0, correctDec: 0, perQuestion: {} };
      }
      const ud = unitDecrements[att.unitId];
      globalDrillsDec++;
      for (const d of att.details) {
        if (!d.qId) continue;
        if (!ud.perQuestion[d.qId]) ud.perQuestion[d.qId] = { total: 0, correct: 0 };
        ud.perQuestion[d.qId].total++;
        ud.totalDec++;
        globalAnsweredDec++;
        if (d.isCorrect) {
          ud.perQuestion[d.qId].correct++;
          ud.correctDec++;
          globalCorrectDec++;
        }
      }
    }

    // バッチで stats を更新
    const batch = writeBatch(db);
    for (const [unitId, ud] of Object.entries(unitDecrements)) {
      const statsRef = doc(db, 'units', unitId, 'stats', 'questions');
      const updates: Record<string, any> = {};
      for (const [qId, qd] of Object.entries(ud.perQuestion)) {
        updates[`${qId}.total`] = increment(-qd.total);
        if (qd.correct > 0) updates[`${qId}.correct`] = increment(-qd.correct);
      }
      batch.update(statsRef, updates);
    }
    // stats/global を更新
    if (globalDrillsDec > 0) {
      batch.update(doc(db, 'stats', 'global'), {
        totalDrills: increment(-globalDrillsDec),
        totalCorrect: increment(-globalCorrectDec),
        totalAnswered: increment(-globalAnsweredDec),
      });
    }
    await batch.commit();
  };

  const handleDeleteScore = async (s: any) => {
    if (!window.confirm('この得点データ(Attempt)を削除しますか？')) return;
    setLoading(true);
    try {
      if (s.path) {
        await deleteDoc(doc(db, s.path));
      } else if (s.uid && s.docId) {
        await deleteDoc(doc(db, 'users', s.uid, 'attempts', s.docId));
      } else {
        throw new Error('Missing path or uid/docId');
      }
      // stats カウンターを連動デクリメント
      try {
        await decrementStatsForAttempts([s]);
      } catch (statsErr) {
        console.warn('Stats decrement failed (non-critical):', statsErr);
      }
      setScores(scores.filter(score => score.docId !== s.docId));
      setMessage('得点データを削除しました。');
    } catch (e) {
      console.error(e);
      setMessage('削除エラーが発生しました。');
    }
    setLoading(false);
  };

  const handleToggleSelectScore = (docId: string) => {
    const newSet = new Set(selectedScoreIds);
    if (newSet.has(docId)) {
      newSet.delete(docId);
    } else {
      newSet.add(docId);
    }
    setSelectedScoreIds(newSet);
  };

  const handleSelectAllScores = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedScoreIds(new Set(scores.map(s => s.docId)));
    } else {
      setSelectedScoreIds(new Set());
    }
  };

  const handleBatchDeleteScores = async () => {
    if (selectedScoreIds.size === 0) return;
    if (!window.confirm(`選択した ${selectedScoreIds.size} 件のデータを一括削除しますか？\n（統計カウンターも連動して更新されます）`)) return;

    setLoading(true);
    try {
      const selectedItems = scores.filter(s => selectedScoreIds.has(s.docId));
      let actuallyDeleted = 0;
      
      for (let i = 0; i < selectedItems.length; i += 400) {
        const batch = writeBatch(db);
        selectedItems.slice(i, i + 400).forEach(s => {
          if (s.path) {
            batch.delete(doc(db, s.path));
            actuallyDeleted++;
          } else if (s.uid && s.docId) {
            batch.delete(doc(db, 'users', s.uid, 'attempts', s.docId));
            actuallyDeleted++;
          }
        });
        await batch.commit();
      }

      // stats カウンターを連動デクリメント
      try {
        await decrementStatsForAttempts(selectedItems);
      } catch (statsErr) {
        console.warn('Stats decrement failed (non-critical):', statsErr);
      }

      setScores(scores.filter(s => !selectedScoreIds.has(s.docId)));
      setSelectedScoreIds(new Set());
      setMessage(`${actuallyDeleted}件の得点データを削除しました。`);
    } catch (e) {
      console.error(e);
      setMessage('削除エラーが発生しました。');
    }
    setLoading(false);
  };

  // --- 全データリセット ---
  const handleResetAllData = async () => {
    if (!window.confirm('⚠️ すべてのプレイデータをリセットしますか？\n\n対象: ユーザーのXP・スコア・ランキング・統計データ\nこの操作は取り消せません。')) return;
    if (!window.confirm('最終確認: すべてのユーザーのスコア、XP、ランキングが0にリセットされます。本当に実行しますか？')) return;

    setLoading(true);
    setMessage('リセット処理中...');

    try {
      // 1. 全 attempts を削除
      const attemptsSnap = await getDocs(collectionGroup(db, 'attempts'));
      for (let i = 0; i < attemptsSnap.docs.length; i += 400) {
        const batch = writeBatch(db);
        attemptsSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      // 2. stats/global をリセット
      await setDoc(doc(db, 'stats', 'global'), {
        totalDrills: 0,
        totalCorrect: 0,
        totalAnswered: 0,
        totalParticipants: 0,
        updatedAt: new Date().toISOString()
      });

      // 3. 各単元の stats/questions をリセット
      const statsSnap = await getDocs(collectionGroup(db, 'stats'));
      for (let i = 0; i < statsSnap.docs.length; i += 400) {
        const batch = writeBatch(db);
        statsSnap.docs.slice(i, i + 400).forEach(d => {
          if (d.id === 'questions') {
            batch.set(d.ref, {});
          }
        });
        await batch.commit();
      }

      // 4. ユーザーデータをリセット（XP、スコア、unitStats）
      const usersSnap = await getDocs(collection(db, 'users'));
      for (let i = 0; i < usersSnap.docs.length; i += 400) {
        const batch = writeBatch(db);
        usersSnap.docs.slice(i, i + 400).forEach(d => {
          batch.update(d.ref, {
            xp: 0,
            level: 1,
            title: '算数卒業生',
            progressPercent: 0,
            currentLevelXp: 0,
            nextLevelXp: 52,
            totalScore: 0,
            unitStats: {},
          });
        });
        await batch.commit();
      }

      // 5. リーダーボードを削除
      const lbSnap = await getDocs(collection(db, 'leaderboards'));
      for (let i = 0; i < lbSnap.docs.length; i += 400) {
        const batch = writeBatch(db);
        lbSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      // 6. wrong_answers を削除
      try {
        const wrongSnap = await getDocs(collectionGroup(db, 'wrong_answers'));
        for (let i = 0; i < wrongSnap.docs.length; i += 400) {
          const batch = writeBatch(db);
          wrongSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      } catch (e) {
        console.warn('wrong_answers の削除に失敗しました (非致命的):', e);
      }

      setGlobalStats({ totalDrills: 0, totalCorrect: 0, totalAnswered: 0, totalParticipants: 0 });
      setScores([]);
      setMessage('✅ すべてのプレイデータをリセットしました。');
      fetchUnits();
      fetchUsers();
    } catch (e) {
      console.error(e);
      setMessage('❌ リセットエラーが発生しました: ' + (e as Error).message);
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

          const unitsMap: Record<string, { unitDoc: any, questions: any[] }> = {};

          data.forEach((row, index) => {
            const { unit_id, question_text, options, answer_index, explanation, image_url, category } = row;
            if (!unit_id) return;

            if (!unitsMap[unit_id]) {
              unitsMap[unit_id] = { 
                unitDoc: {
                  id: unit_id, 
                  title: `単元 ${unit_id}`, 
                  subject: importSubject === 'math' ? '数学' : importSubject === 'english' ? '英語' : importSubject,
                  category: category || '1.正の数と負の数',
                  totalQuestions: 0
                },
                questions: []
              };
            }

            unitsMap[unit_id].questions.push({
              id: `q_${index}`,
              order: unitsMap[unit_id].questions.length,
              question_text: question_text || '',
              options: parseOptions(options),
              answer_index: parseInt(answer_index) || 1,
              explanation: explanation || '',
              image_url: image_url || null,
            });
            unitsMap[unit_id].unitDoc.totalQuestions = unitsMap[unit_id].questions.length;
          });

          const writes: Array<{ ref: any, data: any }> = [];
          Object.values(unitsMap).forEach((u) => {
            writes.push({ ref: doc(db, 'units', u.unitDoc.id), data: u.unitDoc });
            u.questions.forEach(q => {
              writes.push({ ref: doc(collection(db, 'units', u.unitDoc.id, 'questions'), q.id), data: q });
            });
          });

          for (let i = 0; i < writes.length; i += 400) {
            const batch = writeBatch(db);
            writes.slice(i, i + 400).forEach(w => batch.set(w.ref, w.data, { merge: true }));
            await batch.commit();
          }

          setMessage(`完了: ${Object.keys(unitsMap).length} 個の単元データと ${writes.length - Object.keys(unitsMap).length} 問の問題を保存しました。`);
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
        <button 
          onClick={() => setActiveTab('changelog')} 
          className={`px-4 py-2 font-medium ${activeTab === 'changelog' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <History className="inline w-4 h-4 mr-2" />
          更新履歴
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
                  <CardDescription>問題数: {unit.totalQuestions || 0}問</CardDescription>
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
             <div className="flex items-center gap-4">
                <p className="text-sm text-gray-500">総プレイデータ（Attempts）</p>
                {selectedScoreIds.size > 0 && (
                  <Button variant="destructive" size="sm" onClick={handleBatchDeleteScores} disabled={loading}>
                    <Trash2 className="w-4 h-4 mr-2" /> 選択した項目を削除 ({selectedScoreIds.size}件)
                  </Button>
                )}
             </div>
             <Button variant="outline" size="sm" onClick={() => fetchScores(false)} disabled={loading}>
              <RefreshCw className="w-4 h-4 mr-2" /> 再読み込み
            </Button>
          </div>
          
          <div className="bg-white rounded-md shadow overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-600 border-b">
                <tr>
                  <th className="px-4 py-3">
                    <input type="checkbox" onChange={handleSelectAllScores} checked={scores.length > 0 && selectedScoreIds.size === scores.length} />
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
                {scores.map(s => (
                  <tr key={s.docId} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedScoreIds.has(s.docId)} onChange={() => handleToggleSelectScore(s.docId)} />
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
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDeleteScore(s)}>
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
                {users.slice(0, displayUsersCount).map((u, idx) => {
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
          {users.length > displayUsersCount && (
            <Button 
              variant="outline" 
              className="w-full text-xs h-9 text-muted-foreground border-dashed"
              onClick={() => setDisplayUsersCount(prev => prev + 100)}
            >
              もっと見る (+100)
            </Button>
          )}
        </div>
      )}

      {/* ========== TAB: SUSPICIOUS ========== */}
      {activeTab === 'suspicious' && (
        <div className="space-y-4 mt-4">
          {(() => {
            // 1. クライアント側（解答時間）での検知
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
                  avgPerQ, 
                  flag,
                  isServer: false,
                  updatedAtTime: s.date ? new Date(s.date).getTime() : 0,
                  updatedAt: s.date ? new Date(s.date).toISOString() : new Date().toISOString()
                };
              });

            // 2. サーバー側（Cloud Functions）での検知
            const serverSuspicious = suspiciousActivities.map(s => ({
              docId: s.id,
              uid: s.uid,
              userName: s.userName || '不明なユーザー',
              unitId: s.unitId,
              reasons: s.reasons || [],
              updatedAt: s.timestamp?.toDate ? s.timestamp.toDate().toISOString() : new Date().toISOString(),
              updatedAtTime: s.timestamp?.toDate ? s.timestamp.toDate().getTime() : Date.now(),
              isServer: true,
              flag: 'red' as const, // サーバー検知は重要度高
              avgPerQ: 0,
              time: 0,
              score: 0
            }));

            // 3. 統合
            const allSuspicious = [
              ...serverSuspicious, 
              ...suspiciousScores.filter(s => s.flag !== 'green')
            ].sort((a, b) => b.updatedAtTime - a.updatedAtTime);
            
            // フィルタリング
            const filtered = allSuspicious.filter(item => {
              if (suspiciousFilter === 'red') return item.flag === 'red';
              if (suspiciousFilter === 'yellow') return item.flag === 'red' || item.flag === 'yellow';
              return true;
            });

            const redCount = allSuspicious.filter(s => s.flag === 'red').length;
            const yellowCount = allSuspicious.filter(s => s.flag === 'yellow').length;

            return (
              <>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b pb-3">
                  <div className="flex gap-4">
                    <div className="flex items-center gap-1.5 bg-red-50 text-red-700 px-3 py-1.5 rounded-lg border border-red-200 shadow-sm">
                      <AlertTriangle className="w-4 h-4" /> 致命的: {redCount}件
                    </div>
                    <div className="flex items-center gap-1.5 bg-yellow-50 text-yellow-700 px-3 py-1.5 rounded-lg border border-yellow-200 shadow-sm">
                      <AlertTriangle className="w-4 h-4" /> 要注意: {yellowCount}件
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={suspiciousFilter}
                      onChange={(e) => setSuspiciousFilter(e.target.value as any)}
                      className="text-sm border rounded-md px-3 py-1.5 bg-white shadow-sm font-medium"
                    >
                      <option value="red">🚨 致命的のみ (Server / ≤3s)</option>
                      <option value="yellow">⚠️ 要注意以上 (≤5s)</option>
                      <option value="all">全件表示</option>
                    </select>
                    <Button variant="outline" size="sm" onClick={() => fetchScores(false)} disabled={loading} className="shadow-sm">
                      <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> 更新
                    </Button>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-md overflow-hidden border">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-600 border-b">
                      <tr>
                        <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider text-center">判定</th>
                        <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">ユーザー / 単元</th>
                        <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">詳細・検知理由</th>
                        <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider">日時</th>
                        <th className="px-4 py-4 font-bold uppercase text-[10px] tracking-wider text-center">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-gray-700">
                      {filtered.slice(0, displaySuspiciousCount).map((s, idx) => (
                        <tr key={`${s.docId}-${idx}`} className={`hover:bg-gray-50/50 transition-colors ${s.flag === 'red' ? 'bg-red-50/20' : ''}`}>
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
                                onClick={() => { setSelectedUnitForStats(s.unitId); setActiveTab('analytics'); }}
                              >
                                分析
                              </Button>
                              {!s.isServer && (
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-7 text-[10px] font-bold text-red-500 hover:bg-red-50 px-2"
                                  onClick={() => handleDeleteScore(s)}
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
                          <td colSpan={5} className="px-4 py-12 text-center text-gray-400 italic">
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
              </>
            );
          })()}
        </div>
      )}

      {/* ========== TAB: ANALYTICS ========== */}
      {activeTab === 'analytics' && (
        <AnalyticsTab
          units={units}
          scores={scores}
          globalStats={globalStats}
          selectedUnitForStats={selectedUnitForStats}
          setSelectedUnitForStats={setSelectedUnitForStats}
          onResetAllData={handleResetAllData}
        />
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
      
      {activeTab === 'changelog' && (
        <div className="animate-in fade-in duration-500">
          <VersionHistoryPanel />
        </div>
      )}

    </div>
  );
}
