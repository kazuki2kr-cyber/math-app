'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection, getDocs, getDoc, deleteDoc, updateDoc, setDoc, query, orderBy, limit, collectionGroup, startAfter, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FileText, Database, UserCheck, Shield, Zap, BarChart, Users, History } from 'lucide-react';
import { parseOptions } from '@/lib/utils';
import { calculateLevelAndProgress, getTitleForLevel } from '@/lib/xp';
import AnalyticsTab from './components/AnalyticsTab';
import { VersionHistoryPanel } from './components/VersionHistoryPanel';
import ImportTab from './components/ImportTab';
import UnitsTab from './components/UnitsTab';
import ScoresTab from './components/ScoresTab';
import XpTab from './components/XpTab';
import SuspiciousTab from './components/SuspiciousTab';
import RolesTab from './components/RolesTab';
import 'katex/dist/katex.min.css';

const ANALYTICS_EVENT_BATCH_SIZE = 200;

function getAttemptDocId(attempt: any): string | null {
  if (attempt?.docId) return String(attempt.docId);
  if (attempt?.attemptId) return String(attempt.attemptId);
  if (typeof attempt?.path === 'string') {
    const segments = attempt.path.split('/');
    return segments[segments.length - 1] || null;
  }
  return null;
}

function safeAnalyticsDocPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'unknown';
}

function buildTokyoLogicalDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function buildAttemptDeletedAnalyticsEvent(attempt: any, actor: string, reason: string) {
  const attemptId = getAttemptDocId(attempt);
  if (!attemptId) return null;

  return {
    eventType: 'ATTEMPT_DELETED',
    eventVersion: 1,
    occurredAt: serverTimestamp(),
    logicalDate: buildTokyoLogicalDate(),
    attemptId,
    uid: attempt?.uid || null,
    unitId: attempt?.unitId || null,
    source: 'admin',
    reason,
    actor,
  };
}

function queueAttemptDeletedAnalyticsEvent(batch: ReturnType<typeof writeBatch>, attempt: any, actor: string, reason: string) {
  const event = buildAttemptDeletedAnalyticsEvent(attempt, actor, reason);
  if (!event) return false;

  const docId = `delete_${safeAnalyticsDocPart(event.attemptId)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  batch.set(doc(db, 'analytics_events', docId), event);
  return true;
}

export default function AdminPage() {
  const { user, isAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  const [activeTab, setActiveTab] = useState<'import' | 'units' | 'scores' | 'xp' | 'suspicious' | 'analytics' | 'roles' | 'changelog'>('roles');
  const [selectedSuspiciousIds, setSelectedSuspiciousIds] = useState<Set<string>>(new Set());
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
  const [analyticsAutoLoad, setAnalyticsAutoLoad] = useState(false);

  const [importSubject, setImportSubject] = useState<string>('math');
  const [unitFilterSubject, setUnitFilterSubject] = useState<string>('all');
  const [unitFilterCategory, setUnitFilterCategory] = useState<string>('all');

  // Role management state
  const [roleEmail, setRoleEmail] = useState('');
  const [adminList, setAdminList] = useState<Array<{ uid: string; email: string; displayName: string }>>([]);
  const [adminListLoading, setAdminListLoading] = useState(false);

  // Maintenance mode state
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [maintenanceEnd, setMaintenanceEnd] = useState('');
  const [maintenanceUpdateLoading, setMaintenanceUpdateLoading] = useState(false);

  // Custom Claims ベース管理者チェック（AuthContext から取得）

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'units') fetchUnits();
    if (activeTab === 'scores' || activeTab === 'suspicious') fetchScores();
    if (activeTab === 'xp') fetchUsers();
    if (activeTab === 'roles') {
      fetchAdminList();
      fetchMaintenanceStatus();
    }
    if (activeTab !== 'analytics') setAnalyticsAutoLoad(false);
  }, [activeTab, isAdmin]);

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
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email
      }, { merge: true });
      setMessage(`✅ メンテナンスモードを${maintenanceEnabled ? '有効' : '無効'}に設定しました。`);
    } catch (err: any) {
      console.error('Failed to update maintenance status:', err);
      setMessage(`エラー: ${err.message}`);
    } finally {
      setMaintenanceUpdateLoading(false);
    }
  };


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
          stats: null
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
          suspiciousSnap.forEach(d => sArr.push({ id: d.id, ...d.data(), isServer: true }));
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

  const handleDeleteScore = async (s: any) => {
    if (!window.confirm('この得点データ(Attempt)を削除しますか？\n(獲得XPも差し引かれ、レベルが再計算される場合があります)')) return;
    setLoading(true);
    try {
      // 1. XPの差し戻し
      if (s.uid && s.xpGain > 0) {
        const userRef = doc(db, 'users', s.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const uData = userSnap.data();
          const oldXp = uData.xp || 0;
          const newXp = Math.max(0, oldXp - s.xpGain);
          
          const newLvData = calculateLevelAndProgress(newXp);
          await updateDoc(userRef, {
            xp: newXp,
            level: newLvData.level,
            title: getTitleForLevel(newLvData.level),
            progressPercent: newLvData.progressPercent,
            currentLevelXp: newLvData.currentLevelXp,
            nextLevelXp: newLvData.nextLevelXp,
            updatedAt: new Date().toISOString()
          });
          
          // ローカルのユーザーリストも更新
          setUsers(users.map(u => u.docId === s.uid ? { 
            ...u, 
            xp: newXp,
            level: newLvData.level
          } : u));
        }
      }

      // 2. ドキュメントの削除
      const deleteBatch = writeBatch(db);
      let queuedDelete = false;
      if (s.path) {
        deleteBatch.delete(doc(db, s.path));
        queuedDelete = true;
      } else if (s.uid && s.docId) {
        deleteBatch.delete(doc(db, 'users', s.uid, 'attempts', s.docId));
        queuedDelete = true;
      }
      if (queuedDelete) {
        queueAttemptDeletedAnalyticsEvent(deleteBatch, s, user?.uid || user?.email || 'admin', 'single_attempt_delete');
        await deleteBatch.commit();
      }

      setScores(scores.filter(score => score.docId !== s.docId));
      // 不正疑惑リストからも消す
      setSuspiciousActivities(prev => prev.filter(sa => sa.id !== s.id && sa.docId !== s.docId));
      
      setMessage('得点データを削除し、XPを差し戻しました。');
    } catch (e) {
      console.error(e);
      setMessage('削除エラーが発生しました。');
    }
    setLoading(false);
  };

  const handleIgnoreSuspicious = async (activityOrId: any) => {
    setLoading(true);
    try {
      let activity = typeof activityOrId === 'string' 
        ? suspiciousActivities.find(a => a.id === activityOrId)
        : activityOrId;

      if (!activity && typeof activityOrId === 'string') {
        // scores (Auto) から探す
        const score = scores.find(s => s.docId === activityOrId);
        if (score) activity = { ...score, isServer: false, id: score.docId };
      }

      if (!activity) throw new Error('対象のデータが見つかりませんでした。');

      if (!activity.isServer) {
        // 自動検知（Attemptsベース）の場合は、Attemptsドキュメントを更新
        // docId や path が確実に存在することを確認
        const path = activity.path;
        const uid = activity.uid;
        const docId = activity.docId || activity.id;

        let attemptRef;
        if (path) {
          attemptRef = doc(db, path);
        } else if (uid && docId) {
          attemptRef = doc(db, 'users', uid, 'attempts', docId);
        }

        if (attemptRef) {
          await updateDoc(attemptRef, { ignoreFraud: true });
        }
      } else {
        // サーバー検知（suspicious_activitiesベース）の場合は、そのアクティビティを削除
        await deleteDoc(doc(db, 'suspicious_activities', activity.id));
      }
      
      setSuspiciousActivities(prev => prev.filter(a => a.id !== (activity.id || activity.docId)));
      setMessage('報告を無視リストに移動しました。');
    } catch (e: any) {
       console.error(e);
       setMessage('無視処理に失敗しました: ' + e.message);
    }
    setLoading(false);
  };

  const handleBatchActionSuspicious = async (action: 'ignore' | 'delete') => {
    if (selectedSuspiciousIds.size === 0) return;
    const count = selectedSuspiciousIds.size;
    if (action === 'delete' && !window.confirm(`${count}件のデータを一括削除しますか？\n(XPもすべて差し引かれます)`)) return;

    setLoading(true);
    try {
      const QUESTIONS_PER_DRILL = 10;
      const suspiciousScores = scores
        .filter(s => s.time != null && s.time > 0 && !s.ignoreFraud)
        .map(s => {
          const avgPerQ = s.time / QUESTIONS_PER_DRILL;
          let flag: 'red' | 'yellow' | 'green' = 'green';
          if (avgPerQ <= 3) flag = 'red';
          else if (avgPerQ <= 5) flag = 'yellow';
          return { ...s, flag, isServer: false, id: s.docId };
        });
      const serverSuspicious = suspiciousActivities.map(s => ({ ...s, isServer: true }));
      const allSuspicious = [...serverSuspicious, ...suspiciousScores.filter(s => s.flag !== 'green')];
      
      const itemsToProcess = allSuspicious.filter(item => selectedSuspiciousIds.has(item.id || item.docId));

      for (const item of itemsToProcess) {
        if (action === 'delete') {
          // handleDeleteScore と同等の処理が必要だが、バッチ化は複雑なので順次処理（件数が多くない想定）
          await handleDeleteScore(item);
        } else {
          await handleIgnoreSuspicious(item);
        }
      }
      
      setSelectedSuspiciousIds(new Set());
      setMessage(`${count}件の処理が完了しました。`);
    } catch (e: any) {
      console.error(e);
      setMessage('一括処理エラー: ' + e.message);
    }
    setLoading(false);
  };

  const handleToggleSelectSuspicious = (id: string) => {
    const newSet = new Set(selectedSuspiciousIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedSuspiciousIds(newSet);
  };

  const handleResetUserData = async (uid: string, displayName: string) => {
    if (!window.confirm(`⚠️ 警告: ${displayName || uid} さんの全学習データをリセットしますか？\n\n獲得したXP、レベル、ハイスコア、アイコン、演習履歴がすべて消去され、初期状態に戻ります。この操作は取り消せません。`)) return;
    if (!window.confirm(`【最終確認】${displayName || uid} さんのデータを本当にすべて削除しますか？`)) return;

    setLoading(true);
    setMessage('ユーザーデータリセット中...');

    try {
      // 1. ユーザーの全 attempts を取得
      const attemptsSnap = await getDocs(collection(db, 'users', uid, 'attempts'));
      const attemptsCount = attemptsSnap.size;
      const attempts = attemptsSnap.docs.map(d => ({ docId: d.id, path: d.ref.path, ...d.data() }));

      // 3. Attempts サブコレクションの全削除
      for (let i = 0; i < attempts.length; i += ANALYTICS_EVENT_BATCH_SIZE) {
        const batch = writeBatch(db);
        attempts.slice(i, i + ANALYTICS_EVENT_BATCH_SIZE).forEach(attempt => {
          if (attempt.path) {
            batch.delete(doc(db, attempt.path));
            queueAttemptDeletedAnalyticsEvent(batch, attempt, user?.uid || user?.email || 'admin', 'user_data_reset');
          }
        });
        await batch.commit();
      }
      
      // 4. wrong_answers サブコレクションの削除
      const wrongSnap = await getDocs(collection(db, 'users', uid, 'wrong_answers'));
      for (let i = 0; i < wrongSnap.docs.length; i += 400) {
        const batch = writeBatch(db);
        wrongSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      // 5. ユーザードキュメントの初期化
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        xp: 0,
        level: 1,
        title: '算数卒業生',
        totalScore: 0,
        unitStats: {},
        icon: '📐',
        progressPercent: 0,
        currentLevelXp: 0,
        nextLevelXp: 52,
        updatedAt: new Date().toISOString()
      });

      // 7. リーダーボード（配列形式）の更新
      try {
        const lbRef = doc(db, 'leaderboards', 'overall');
        const lbSnap = await getDoc(lbRef);
        if (lbSnap.exists()) {
          const rankings = lbSnap.data().rankings || [];
          const newRankings = rankings.filter((r: any) => r.uid !== uid);
          if (rankings.length !== newRankings.length) {
            await updateDoc(lbRef, { rankings: newRankings });
          }
        }
      } catch (lbErr) {
        console.warn('Leaderboard cleanup failed:', lbErr);
      }

      // ローカルステートの更新
      setUsers(users.map(u => u.docId === uid ? {
        ...u,
        xp: 0,
        level: 1,
        totalScore: 0,
        icon: '📐'
      } : u));

      setMessage(`✅ ${displayName || uid} さんのデータを初期化しました。`);
    } catch (e: any) {
      console.error(e);
      setMessage(`❌ エラーが発生しました: ${e.message}`);
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
      
      for (let i = 0; i < selectedItems.length; i += ANALYTICS_EVENT_BATCH_SIZE) {
        const batch = writeBatch(db);
        selectedItems.slice(i, i + ANALYTICS_EVENT_BATCH_SIZE).forEach(s => {
          if (s.path) {
            batch.delete(doc(db, s.path));
            queueAttemptDeletedAnalyticsEvent(batch, s, user?.uid || user?.email || 'admin', 'batch_attempt_delete');
            actuallyDeleted++;
          } else if (s.uid && s.docId) {
            batch.delete(doc(db, 'users', s.uid, 'attempts', s.docId));
            queueAttemptDeletedAnalyticsEvent(batch, s, user?.uid || user?.email || 'admin', 'batch_attempt_delete');
            actuallyDeleted++;
          }
        });
        await batch.commit();
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
      await setDoc(doc(db, 'analytics_events', `reset_${Date.now()}`), {
        eventType: 'ALL_DATA_RESET',
        eventVersion: 1,
        occurredAt: serverTimestamp(),
        logicalDate: buildTokyoLogicalDate(),
        source: 'admin',
        actor: user?.uid || user?.email || 'admin',
      });

      const attemptsSnap = await getDocs(collectionGroup(db, 'attempts'));
      for (let i = 0; i < attemptsSnap.docs.length; i += 400) {
        const batch = writeBatch(db);
        attemptsSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      // 2. stats/global をリセット
      await setDoc(doc(db, 'stats', 'global'), {
        totalParticipants: 0,
        updatedAt: new Date().toISOString()
      });

      // 4. ユーザーデータをリセット（XP、スコア、unitStats）
      const usersSnap = await getDocs(collection(db, 'users'));
      for (let i = 0; i < usersSnap.docs.length; i += 400) {
        const batch = writeBatch(db);
        usersSnap.docs.slice(i, i + 400).forEach(d => {
          batch.update(d.ref, {
            xp: 0,
            level: 1,
            title: '算数卒業生',
            icon: '📐',
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

      setGlobalStats({ totalParticipants: 0 });
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

    import('papaparse').then(({ default: Papa }) => Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const data = results.data as any[];
          setMessage(`解析完了. ${data.length}件のレコードを処理しています...`);

          const unitsMap: Record<string, { unitDoc: any, questions: any[] }> = {};

          data.forEach((row) => {
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

            // IDは単元内の連番で生成（全体行番号を使うと他単元の問題数に依存し、
            // 再インポート時にIDがズレて wrongQuestionIds の追跡が壊れる）
            const localIndex = unitsMap[unit_id].questions.length;
            unitsMap[unit_id].questions.push({
              id: `q_${localIndex}`,
              order: localIndex,
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
    }));
  };

  if (!isAdmin && user) {
    return (
      <div className="p-8 text-center text-red-500 font-bold">
        管理者権限がありません。
      </div>
    );
  }

  const handleDownloadTemplate = () => {
    // unit_id がそのまま単元の表示名になります（例: "1.正負の数の加減" と入力すると画面にその名前で表示）
    // answer_index は選択肢の番号（1始まり）。options の2番目が正解なら 2 と記入
    // image_url は省略可（末尾のカンマだけ残して空欄にする）
    const csvContent =
`unit_id,category,question_text,options,answer_index,explanation,image_url
1.正負の数の加減,1.正の数と負の数,$1+1$は？,"[""1"",""2"",""3"",""4""]",2,1足す1は2です。,
1.正負の数の加減,1.正の数と負の数,$x^2=4$ を解け,"[""x=2"",""x=-2"",""x=\\pm 2"",""解なし""]",3,平方根をとります。,
2.文字と式,2.文字と式,次の図形の面積を求めよ,"[""10"",""20"",""30"",""40""]",2,底辺×高さ÷2です。,https://example.com/image.png
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
          経験値・スコア管理
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
        <ImportTab
          loading={loading}
          importSubject={importSubject}
          setImportSubject={setImportSubject}
          onFileUpload={handleFileUpload}
          onDownloadTemplate={handleDownloadTemplate}
        />
      )}

      {/* ========== TAB: UNITS ========== */}
      {activeTab === 'units' && (
        <UnitsTab
          units={units}
          loading={loading}
          unitFilterSubject={unitFilterSubject}
          setUnitFilterSubject={setUnitFilterSubject}
          unitFilterCategory={unitFilterCategory}
          setUnitFilterCategory={setUnitFilterCategory}
          onDeleteUnit={handleDeleteUnit}
          onDeleteQuestion={handleDeleteQuestion}
          onRefresh={fetchUnits}
        />
      )}

      {/* ========== TAB: SCORES ========== */}
      {activeTab === 'scores' && (
        <ScoresTab
          scores={scores}
          loading={loading}
          displayScoresCount={displayScoresCount}
          setDisplayScoresCount={setDisplayScoresCount}
          selectedScoreIds={selectedScoreIds}
          onToggleSelect={handleToggleSelectScore}
          onSelectAll={handleSelectAllScores}
          onBatchDelete={handleBatchDeleteScores}
          onDeleteScore={handleDeleteScore}
          onRefresh={() => fetchScores(false)}
        />
      )}

      {/* ========== TAB: XP MANAGEMENT ========== */}
      {activeTab === 'xp' && (
        <XpTab
          users={users}
          loading={loading}
          displayUsersCount={displayUsersCount}
          setDisplayUsersCount={setDisplayUsersCount}
          editingXp={editingXp}
          setEditingXp={setEditingXp}
          onUpdateXp={handleUpdateXp}
          onResetUserData={handleResetUserData}
          onRefresh={fetchUsers}
        />
      )}
      {/* ========== TAB: SUSPICIOUS ========== */}
      {activeTab === 'suspicious' && (
        <SuspiciousTab
          scores={scores}
          suspiciousActivities={suspiciousActivities}
          loading={loading}
          suspiciousFilter={suspiciousFilter}
          setSuspiciousFilter={setSuspiciousFilter}
          selectedSuspiciousIds={selectedSuspiciousIds}
          setSelectedSuspiciousIds={setSelectedSuspiciousIds}
          displaySuspiciousCount={displaySuspiciousCount}
          setDisplaySuspiciousCount={setDisplaySuspiciousCount}
          onDeleteScore={handleDeleteScore}
          onIgnoreSuspicious={handleIgnoreSuspicious}
          onBatchAction={handleBatchActionSuspicious}
          onSetUnitForStats={setSelectedUnitForStats}
          onSwitchToAnalytics={() => { setAnalyticsAutoLoad(true); setActiveTab('analytics'); }}
          onRefresh={() => fetchScores(false)}
        />
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
          onLoadData={async () => {
            await fetchUnits();
            await fetchScores();
          }}
          autoLoad={analyticsAutoLoad}
        />
      )}

      {/* ========== TAB: ROLES & MAINTENANCE ========== */}
      {activeTab === 'roles' && (
        <RolesTab
          maintenanceEnabled={maintenanceEnabled}
          setMaintenanceEnabled={setMaintenanceEnabled}
          maintenanceMessage={maintenanceMessage}
          setMaintenanceMessage={setMaintenanceMessage}
          maintenanceEnd={maintenanceEnd}
          setMaintenanceEnd={setMaintenanceEnd}
          maintenanceUpdateLoading={maintenanceUpdateLoading}
          onUpdateMaintenance={handleUpdateMaintenance}
          roleEmail={roleEmail}
          setRoleEmail={setRoleEmail}
          adminList={adminList}
          adminListLoading={adminListLoading}
          onFetchAdminList={fetchAdminList}
          onSetMessage={setMessage}
        />
      )}
      
      {activeTab === 'changelog' && (
        <div className="animate-in fade-in duration-500">
          <VersionHistoryPanel />
        </div>
      )}

    </div>
  );
}
