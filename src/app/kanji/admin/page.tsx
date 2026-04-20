'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection, getDocs, getDoc, setDoc } from 'firebase/firestore';
import { FileText, Database, Users, Settings } from 'lucide-react';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';

import KanjiImportTab from './components/KanjiImportTab';
import KanjiUnitsTab from './components/KanjiUnitsTab';
import KanjiUsersTab from './components/KanjiUsersTab';
import KanjiSettingsTab from './components/KanjiSettingsTab';

export default function KanjiAdminPage() {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  const [activeTab, setActiveTab] = useState<'import' | 'units' | 'users' | 'settings'>('units');
  const [units, setUnits] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  // Maintenance mode state
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [maintenanceEnd, setMaintenanceEnd] = useState('');
  const [maintenanceUpdateLoading, setMaintenanceUpdateLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'units') fetchUnits();
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'settings') fetchMaintenanceStatus();
  }, [activeTab, isAdmin]);

  const fetchUnits = async () => {
    setLoading(true);
    setMessage('');
    try {
      const snap = await getDocs(collection(db, 'units'));
      const unitsArray = snap.docs.map(d => d.data());
      
      const arr = await Promise.all(unitsArray.map(async unit => {
        const qSnap = await getDocs(collection(db, 'units', unit.id, 'questions'));
        const questions = qSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return {
          ...unit,
          questions
        };
      }));

      setUnits(arr);
    } catch (e) {
      console.error(e);
      setMessage('単元の取得に失敗しました。');
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
      // 漢字XPでソート
      arr.sort((a, b) => (b.kanjiXp || 0) - (a.kanjiXp || 0));
      setUsers(arr);
    } catch (e) {
      console.error(e);
      setMessage('ユーザー情報の取得に失敗しました。');
    }
    setLoading(false);
  };

  const fetchMaintenanceStatus = async () => {
    try {
      const snap = await getDoc(doc(db, 'config', 'maintenance'));
      if (snap.exists()) {
        const data = snap.data();
        setMaintenanceEnabled(data.enabled || false);
        setMaintenanceMessage(data.message || '');
        setMaintenanceEnd(data.scheduledEnd || '');
      }
    } catch (err) {
      console.error('Failed to fetch maintenance status:', err);
    }
  };

  const handleUpdateMaintenance = async () => {
    setMaintenanceUpdateLoading(true);
    try {
      await setDoc(doc(db, 'config', 'maintenance'), {
        enabled: maintenanceEnabled,
        message: maintenanceMessage,
        scheduledEnd: maintenanceEnd,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setMessage(`✅ メンテナンスモードを${maintenanceEnabled ? '有効' : '無効'}に設定しました。`);
    } catch (err: any) {
      console.error('Failed to update maintenance status:', err);
      setMessage(`エラー: ${err.message}`);
    } finally {
      setMaintenanceUpdateLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setMessage('');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rows = results.data as any[];
          const grouped: Record<string, any[]> = {};
          
          let titlePrefix = '';
          rows.forEach((r, i) => {
            const uidStr = r.unit_id ? String(r.unit_id).trim() : '';
            if (!uidStr) throw new Error(`${i + 1}行目の unit_id がありません。`);
            if (!grouped[uidStr]) grouped[uidStr] = [];
            grouped[uidStr].push({ ...r, _origRowId: i + 1 });
            if (!titlePrefix && r.title) titlePrefix = String(r.title);
          });

          const batch = writeBatch(db);
          for (const [unitId, qs] of Object.entries(grouped)) {
            const first = qs[0];
            const title = first.title || `${unitId}`;
            const category = first.category || 'その他';

            const unitRef = doc(db, 'units', unitId);
            batch.set(unitRef, {
              id: unitId,
              title,
              category,
              subject: 'kanji',
              totalQuestions: qs.length,
              createdAt: new Date().toISOString()
            });

            qs.forEach((qData, qIndex) => {
              const qId = `${unitId}-q${qIndex + 1}`;
              const qRef = doc(db, 'units', unitId, 'questions', qId);
              let answer = String(qData.answer || '').trim();
              
              // optionsがなくともanswerを直接使用（複数文字にも対応可能）
              batch.set(qRef, {
                question_text: qData.question_text || '',
                answer: answer,
                explanation: qData.explanation || ''
              });
            });
          }

          await batch.commit();
          setMessage(`✅ インポート完了: ${Object.keys(grouped).length} 単元、計 ${rows.length} 問の漢字問題を登録しました。`);
          e.target.value = '';
          if (activeTab === 'units') fetchUnits();
        } catch (err: any) {
          setMessage(`❌ CSVエラー: ${err.message}`);
        } finally {
          setLoading(false);
        }
      },
      error: (err) => {
        setMessage(`❌ CSV解析エラー: ${err.message}`);
        setLoading(false);
      }
    });
  };

  const handleDownloadTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" +
      "unit_id,title,category,question_text,answer,explanation\n" +
      "kanji-unit-1,一年生の漢字,漢字,高いやまに登る。,山,山（やま）という字です。\n" +
      "kanji-unit-1,一年生の漢字,漢字,美しいかわが流れる。,川,川（かわ）という字です。\n" +
      "kanji-multi-1,2語の漢字,漢字,やまかわに出かける。,山川,山川（やまかわ）となります。";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "kanji_template.csv");
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  if (!isAdmin) {
    return <div className="p-8 text-center bg-[#FDF6E3] min-h-screen font-serif text-orange-950">管理者権限がありません。</div>;
  }

  return (
    <div className="min-h-screen bg-[#FDF6E3] p-4 sm:p-8 font-serif">
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold flex items-center text-orange-950">
          <Database className="w-8 h-8 mr-3 text-orange-600" />
          漢字ドリル専用ダッシュボード
        </h1>
        {message && (
          <div className={`p-4 rounded-xl shadow-sm text-sm font-bold ${message.startsWith('❌') || message.startsWith('エラー') ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-green-50 text-green-700 border border-green-100'}`}>
            {message}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-6">
          <Button variant={activeTab === 'units' ? 'default' : 'outline'} onClick={() => setActiveTab('units')} className={activeTab === 'units' ? 'bg-orange-900 border-none' : 'border-orange-200 text-orange-900 bg-white'}>
            <FileText className="w-4 h-4 mr-2" /> 単元一覧・削除
          </Button>
          <Button variant={activeTab === 'import' ? 'default' : 'outline'} onClick={() => setActiveTab('import')} className={activeTab === 'import' ? 'bg-orange-900 border-none' : 'border-orange-200 text-orange-900 bg-white'}>
            <Database className="w-4 h-4 mr-2" /> 単元インポート
          </Button>
          <Button variant={activeTab === 'users' ? 'default' : 'outline'} onClick={() => setActiveTab('users')} className={activeTab === 'users' ? 'bg-orange-900 border-none' : 'border-orange-200 text-orange-900 bg-white'}>
            <Users className="w-4 h-4 mr-2" /> 個別ユーザー管理
          </Button>
          <Button variant={activeTab === 'settings' ? 'default' : 'outline'} onClick={() => setActiveTab('settings')} className={activeTab === 'settings' ? 'bg-orange-900 border-none' : 'border-orange-200 text-orange-900 bg-white'}>
            <Settings className="w-4 h-4 mr-2" /> システム設定
          </Button>
        </div>

        {activeTab === 'import' && (
          <KanjiImportTab 
            loading={loading}
            onFileUpload={handleFileUpload}
            onDownloadTemplate={handleDownloadTemplate}
          />
        )}
        {activeTab === 'units' && (
          <KanjiUnitsTab 
            units={units}
            loading={loading}
            refreshUnits={fetchUnits}
            setMessage={setMessage}
          />
        )}
        {activeTab === 'users' && (
          <KanjiUsersTab 
            users={users}
            loading={loading}
            refreshUsers={fetchUsers}
            setMessage={setMessage}
          />
        )}
        {activeTab === 'settings' && (
          <KanjiSettingsTab
            maintenanceEnabled={maintenanceEnabled}
            setMaintenanceEnabled={setMaintenanceEnabled}
            maintenanceMessage={maintenanceMessage}
            setMaintenanceMessage={setMaintenanceMessage}
            maintenanceEnd={maintenanceEnd}
            setMaintenanceEnd={setMaintenanceEnd}
            maintenanceUpdateLoading={maintenanceUpdateLoading}
            onUpdateMaintenance={handleUpdateMaintenance}
          />
        )}
      </div>
    </div>
  );
}
