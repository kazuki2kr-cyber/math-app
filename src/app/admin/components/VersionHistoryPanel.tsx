'use client';

import React, { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, limit, getDocs, doc, setDoc, addDoc, deleteDoc, Timestamp, writeBatch } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { History, Calendar, CheckCircle2, Package, Plus, Edit2, Trash2, Save, X, AlertTriangle } from 'lucide-react';

interface ChangelogEntry {
  id: string;
  version: string;
  date: any; // Firestore Timestamp
  summary: string;
  details: string[];
  type: 'major' | 'minor' | 'patch' | 'hotfix';
}

export function VersionHistoryPanel() {
  const [logs, setLogs] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    version: '',
    summary: '',
    type: 'patch' as ChangelogEntry['type'],
    details: [''],
    date: new Date().toISOString().split('T')[0]
  });

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'changelog'),
        orderBy('date', 'desc'),
        limit(20)
      );
      const snap = await getDocs(q);
      const fetchedLogs = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ChangelogEntry[];
      setLogs(fetchedLogs);
    } catch (err) {
      console.error('Failed to fetch changelog:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleOpenCreate = () => {
    setFormData({
      version: '',
      summary: '',
      type: 'patch',
      details: [''],
      date: new Date().toISOString().split('T')[0]
    });
    setEditingId(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (log: ChangelogEntry) => {
    setFormData({
      version: log.version,
      summary: log.summary,
      type: log.type || 'patch',
      details: log.details.length > 0 ? [...log.details] : [''],
      date: log.date?.toDate ? log.date.toDate().toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    });
    setEditingId(log.id);
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const dataToSave = {
        version: formData.version,
        summary: formData.summary,
        type: formData.type,
        details: formData.details.filter(d => d.trim() !== ''),
        date: Timestamp.fromDate(new Date(formData.date))
      };

      if (editingId) {
        await setDoc(doc(db, 'changelog', editingId), dataToSave, { merge: true });
      } else {
        await addDoc(collection(db, 'changelog'), dataToSave);
      }
      
      setIsFormOpen(false);
      fetchLogs();
    } catch (err) {
      console.error('Save failed:', err);
      alert('保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('この履歴を削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'changelog', id));
      fetchLogs();
    } catch (err) {
      console.error('Delete failed:', err);
      alert('削除に失敗しました。');
    }
  };

  const getTypeColor = (type?: string) => {
    switch (type) {
      case 'major': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'minor': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'patch': return 'bg-green-100 text-green-700 border-green-200';
      case 'hotfix': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const handleMigration = async () => {
    if (!window.confirm('全テストデータのquestionsプロパティを抽出し、サブコレクションへ移行します。よろしいですか？')) return;
    
    setSaving(true);
    try {
      const dbSnap = await getDocs(collection(db, 'units'));
      const writes: Array<{ ref: any, data: any, type: string }> = [];

      dbSnap.forEach(uDoc => {
        const u = uDoc.data();
        if (u.questions && Array.isArray(u.questions) && u.questions.length > 0) {
          
          u.questions.forEach((q: any, i: number) => {
             writes.push({ 
               type: 'set',
               ref: doc(collection(db, 'units', uDoc.id, 'questions'), q.id || `q_${i}`), 
               data: { ...q, order: q.order ?? i } 
             });
          });

          // Delete `questions` from the unit Doc and set `totalQuestions`
          writes.push({ 
            type: 'set',
            ref: doc(db, 'units', uDoc.id), 
            data: { _legacy_questions: u.questions, totalQuestions: u.questions.length, questions: null } 
          });
        }
      });

      if (writes.length === 0) {
        alert('移行するデータが見つかりませんでした (既に移行済み、またはデータがありません)。');
        return;
      }

      for (let i = 0; i < writes.length; i += 400) {
        const batch = writeBatch(db);
        writes.slice(i, i + 400).forEach(w => batch.set(w.ref, w.data, { merge: true }));
        await batch.commit();
      }

      alert(`マイグレーションが完了しました。(${writes.length}件の書き込み)`);
    } catch (err) {
      console.error('Migration failed:', err);
      alert('マイグレーションに失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <History className="w-6 h-6 text-primary" />
            バージョン更新履歴
          </h2>
          <p className="text-gray-500 mt-1">システムのアップデート履歴と改善内容を管理します。</p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleOpenCreate} className="shadow-md">
            <Plus className="w-4 h-4 mr-2" /> 新規作成
          </Button>
          <div className="hidden md:flex items-center gap-2 bg-primary/5 px-4 py-2 rounded-lg border border-primary/10">
            <Package className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-primary font-mono">v1.0.2</span>
          </div>
        </div>
      </div>

      {isFormOpen && (
        <Card className="border-2 border-primary shadow-xl animate-in slide-in-from-top-4 duration-300">
          <CardHeader className="bg-primary/5 border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              {editingId ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              {editingId ? '更新履歴の編集' : '新規更新履歴の作成'}
            </CardTitle>
          </CardHeader>
          <form onSubmit={handleSave}>
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase">バージョン</label>
                  <Input 
                    placeholder="1.0.3" 
                    value={formData.version} 
                    onChange={e => setFormData({...formData, version: e.target.value})}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase">タイプ</label>
                  <select 
                    className="w-full h-10 px-3 py-2 text-sm bg-white border rounded-md outline-none focus:ring-2 focus:ring-primary/20"
                    value={formData.type}
                    onChange={e => setFormData({...formData, type: e.target.value as any})}
                  >
                    <option value="patch">Patch (バグ修正等)</option>
                    <option value="minor">Minor (新機能等)</option>
                    <option value="major">Major (大規模更新)</option>
                    <option value="hotfix">Hotfix (緊急修正)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase">リリース日</label>
                  <Input 
                    type="date" 
                    value={formData.date} 
                    onChange={e => setFormData({...formData, date: e.target.value})}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">サマリー（タイトル）</label>
                <Input 
                  placeholder="UIパターンの改善とセキュリティ強化" 
                  value={formData.summary} 
                  onChange={e => setFormData({...formData, summary: e.target.value})}
                  required
                />
              </div>

              <div className="space-y-3">
                <label className="text-xs font-bold text-gray-500 uppercase flex justify-between items-center">
                  詳細（箇条書き）
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 text-primary"
                    onClick={() => setFormData({...formData, details: [...formData.details, '']})}
                  >
                    <Plus className="w-3 h-3 mr-1" /> 行を追加
                  </Button>
                </label>
                {formData.details.map((detail, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input 
                      placeholder={`改善点 ${idx + 1}`} 
                      value={detail} 
                      onChange={e => {
                        const newDetails = [...formData.details];
                        newDetails[idx] = e.target.value;
                        setFormData({...formData, details: newDetails});
                      }}
                    />
                    {formData.details.length > 1 && (
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setFormData({...formData, details: formData.details.filter((_, i) => i !== idx)})}
                      >
                        <Trash2 className="w-4 h-4 text-gray-400" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                  キャンセル
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <><div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2" /> 保存中...</>
                  ) : (
                    <><Save className="w-4 h-4 mr-2" /> 履歴を保存</>
                  )}
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>
      )}

      <div className="grid gap-6">
        {logs.length > 0 ? (
          logs.map((log) => (
            <Card key={log.id} className="group border-0 shadow-lg overflow-hidden bg-white hover:shadow-xl transition-all duration-300">
              <div className={`h-1.5 w-full ${log.type === 'major' ? 'bg-purple-500' : log.type === 'hotfix' ? 'bg-red-500' : 'bg-primary'}`}></div>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border uppercase tracking-wider ${getTypeColor(log.type)}`}>
                      v{log.version}
                    </span>
                    <CardTitle className="text-lg font-bold text-gray-800">{log.summary}</CardTitle>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center text-xs text-gray-400 font-mono">
                      <Calendar className="w-3.5 h-3.5 mr-1.5" />
                      {log.date?.toDate ? log.date.toDate().toLocaleDateString('ja-JP') : '不明'}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleOpenEdit(log)}>
                        <Edit2 className="w-4 h-4 text-gray-400 hover:text-primary" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleDelete(log.id)}>
                        <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-500" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {log.details.map((detail, idx) => (
                    <li key={idx} className="flex items-start text-sm text-gray-600 leading-relaxed">
                      <CheckCircle2 className="w-4 h-4 mr-2.5 mt-0.5 text-primary/60 shrink-0" />
                      {detail}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))
        ) : (
          !loading && (
            <div className="text-center py-20 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
              <History className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 font-medium">更新履歴がまだありません。</p>
              <p className="text-gray-400 text-sm mt-1">「新規作成」ボタンから履歴を追加してください。</p>
            </div>
          )
        )}
      </div>

      <Card className="border-red-200 shadow-sm bg-red-50/30 mt-12">
        <CardHeader className="pb-2">
          <CardTitle className="text-md text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            開発者向け機能
          </CardTitle>
          <CardDescription>
            既存の問題データを最適化するマイグレーションスクリプト。1度だけ実行してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-100" onClick={handleMigration} disabled={saving}>
             {saving ? '処理中...' : '問題データのサブコレクション化マイグレーションを実行'}
          </Button>
        </CardContent>
      </Card>

    </div>
  );
}

