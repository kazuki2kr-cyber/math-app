'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection, getDocs, getDoc, deleteDoc, updateDoc, setDoc, query, orderBy, limit, collectionGroup, startAfter, serverTimestamp, increment, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FileText, Database, UserCheck, Shield, Zap, BarChart, Users, MessageSquare, Bell } from 'lucide-react';
import { parseOptions } from '@/lib/utils';
import { calculateLevelAndProgress, getTitleForLevel } from '@/lib/xp';
import AnalyticsTab from './components/AnalyticsTab';
import ImportTab from './components/ImportTab';
import UnitsTab from './components/UnitsTab';
import ScoresTab from './components/ScoresTab';
import XpTab from './components/XpTab';
import SuspiciousTab from './components/SuspiciousTab';
import RolesTab from './components/RolesTab';
import FeedbackTab from './components/FeedbackTab';
import WrittenAnalyticsTab from './components/WrittenAnalyticsTab';
import NotificationsTab from './components/NotificationsTab';
import 'katex/dist/katex.min.css';

const ANALYTICS_EVENT_BATCH_SIZE = 200;

function getImportSubjectMetadata(importSubject: string) {
  switch (importSubject) {
    case 'math':
      return { subject: '数学', baseSubject: '数学', mode: 'solo' };
    case 'math_written':
      return { subject: '数学', baseSubject: '数学', mode: 'solo', drillType: 'written' };
    case 'english':
      return { subject: '英語', baseSubject: '英語', mode: 'solo' };
    default:
      return { subject: importSubject, baseSubject: importSubject, mode: 'solo' };
  }
}

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
  
  const [activeTab, setActiveTab] = useState<'import' | 'units' | 'scores' | 'xp' | 'suspicious' | 'analytics' | 'writtenAnalytics' | 'feedback' | 'writtenFeedback' | 'notifications' | 'roles'>('roles');
  const [units, setUnits] = useState<any[]>([]);
  const [scores, setScores] = useState<any[]>([]); // holds attempts now
  const [lastAttemptDoc, setLastAttemptDoc] = useState<any>(null);
  const [hasMoreAttempts, setHasMoreAttempts] = useState(true);
  const [suspiciousActivities, setSuspiciousActivities] = useState<any[]>([]);
  const [integritySummaries, setIntegritySummaries] = useState<any[]>([]);
  const [integrityEventsByUid, setIntegrityEventsByUid] = useState<Record<string, any[]>>({});
  const [integrityLoadingUid, setIntegrityLoadingUid] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [feedbackItems, setFeedbackItems] = useState<any[]>([]);
  const [writtenFeedbackItems, setWrittenFeedbackItems] = useState<any[]>([]);
  const [editingXp, setEditingXp] = useState<Record<string, string>>({});
  const [displayScoresCount, setDisplayScoresCount] = useState(50);
  const [displayUsersCount, setDisplayUsersCount] = useState(50);
  const [selectedScoreIds, setSelectedScoreIds] = useState<Set<string>>(new Set());
  
  // Analytics
  const [selectedUnitForStats, setSelectedUnitForStats] = useState<string>('');
  const [globalStats, setGlobalStats] = useState<any>(null);
  const [analyticsAutoLoad, setAnalyticsAutoLoad] = useState(false);

  const [importSubject, setImportSubject] = useState<string>('math');
  const [unitFilterSubject, setUnitFilterSubject] = useState<string>('all');
  const [unitFilterCategory, setUnitFilterCategory] = useState<string>('all');
  const [updatingQuestionKeys, setUpdatingQuestionKeys] = useState<Set<string>>(new Set());
  const [updatingUnitIds, setUpdatingUnitIds] = useState<Set<string>>(new Set());

  // Role management state
  const [roleEmail, setRoleEmail] = useState('');
  const [adminList, setAdminList] = useState<Array<{ uid: string; email: string; displayName: string }>>([]);
  const [adminListLoading, setAdminListLoading] = useState(false);
  const [appAccessEmail, setAppAccessEmail] = useState('');
  const [appAccessAccounts, setAppAccessAccounts] = useState<Array<{ uid: string; email: string; displayName: string; appAccess: boolean }>>([]);
  const [appAccessInvites, setAppAccessInvites] = useState<Array<{ email: string; createdAt: string; createdByEmail: string }>>([]);
  const [appAccessListLoading, setAppAccessListLoading] = useState(false);

  // Maintenance mode state
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [maintenanceEnd, setMaintenanceEnd] = useState('');
  const [maintenanceUpdateLoading, setMaintenanceUpdateLoading] = useState(false);

  // Custom Claims ベース管理者チェック（AuthContext から取得）

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'units') fetchUnits();
    if (activeTab === 'scores') fetchScores();
    if (activeTab === 'suspicious') fetchIntegritySummaries();
    if (activeTab === 'xp') fetchUsers();
    if (activeTab === 'feedback') fetchFeedback();
    if (activeTab === 'writtenFeedback') fetchWrittenFeedback();
    if (activeTab === 'roles') {
      fetchAdminList();
      fetchAppAccessList();
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

  const fetchFeedback = async () => {
    if (!isAdmin) return;
    setLoading(true);
    setMessage('');
    try {
      const snap = await getDocs(query(collection(db, 'user_feedback'), orderBy('createdAt', 'desc'), limit(100)));
      setFeedbackItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
      setMessage('フィードバックの取得に失敗しました。');
    }
    setLoading(false);
  };

  const fetchWrittenFeedback = async () => {
    if (!isAdmin) return;
    setLoading(true);
    setMessage('');
    try {
      const snap = await getDocs(query(collection(db, 'written_grading_feedback'), orderBy('createdAt', 'desc'), limit(100)));
      setWrittenFeedbackItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
      setMessage('記述式採点フィードバックの取得に失敗しました。');
    }
    setLoading(false);
  };

  const handleDeleteFeedback = async (feedback: any) => {
    if (!feedback?.id) return;
    const preview = String(feedback.message || '').slice(0, 80);
    if (!window.confirm(`このフィードバックを削除しますか？\n\n${preview}`)) return;

    setLoading(true);
    setMessage('');
    try {
      await deleteDoc(doc(db, 'user_feedback', feedback.id));
      setFeedbackItems(prev => prev.filter(item => item.id !== feedback.id));
      setMessage('フィードバックを削除しました。');
    } catch (e: any) {
      console.error(e);
      setMessage(`フィードバックの削除に失敗しました: ${e.message || e}`);
    }
    setLoading(false);
  };

  const handleDeleteWrittenFeedback = async (feedback: any) => {
    if (!feedback?.id) return;
    const preview = String(feedback.message || feedback.unitTitle || '').slice(0, 80);
    if (!window.confirm(`記述式採点フィードバックを削除しますか？\n\n${preview}`)) return;

    setLoading(true);
    setMessage('');
    try {
      await deleteDoc(doc(db, 'written_grading_feedback', feedback.id));
      setWrittenFeedbackItems(prev => prev.filter(item => item.id !== feedback.id));
      setMessage('記述式採点フィードバックを削除しました。');
    } catch (e: any) {
      console.error(e);
      setMessage(`記述式採点フィードバックの削除に失敗しました: ${e.message || e}`);
    }
    setLoading(false);
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

  const fetchAppAccessList = async () => {
    setAppAccessListLoading(true);
    try {
      const functions = getFunctions(undefined, 'us-central1');
      const listAppAccessAccountsFn = httpsCallable(functions, 'listAppAccessAccounts');
      const result: any = await listAppAccessAccountsFn({});
      setAppAccessAccounts(result.data.accounts || []);
      setAppAccessInvites(result.data.invites || []);
    } catch (err: any) {
      console.error('Failed to fetch app access list:', err);
      setMessage(`利用許可一覧の取得エラー: ${err.message}`);
    } finally {
      setAppAccessListLoading(false);
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

  const fetchIntegritySummaries = async () => {
    if (!isAdmin) return;
    setLoading(true);
    setMessage('');
    try {
      const snap = await getDocs(query(
        collection(db, 'integrity_user_summaries'),
        orderBy('lastFlaggedAt', 'desc'),
        limit(50),
      ));
      const summaries = snap.docs.map((summaryDoc) => ({
        id: summaryDoc.id,
        ...summaryDoc.data(),
      }));
      setIntegritySummaries(summaries);
      setIntegrityEventsByUid({});

      // 旧形式の未レビュー履歴も移行期間中は併記する。
      await fetchScores(false);
    } catch (error) {
      console.error(error);
      setMessage('インテグリティサマリーの取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const fetchIntegrityEvents = async (uid: string) => {
    if (!isAdmin || !uid) return;
    setIntegrityLoadingUid(uid);
    try {
      const snap = await getDocs(query(
        collection(db, 'integrity_events'),
        where('uid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(20),
      ));
      setIntegrityEventsByUid((previous) => ({
        ...previous,
        [uid]: snap.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() })),
      }));
    } catch (error) {
      console.error(error);
      setMessage('ユーザー別の検知詳細を取得できませんでした。');
    } finally {
      setIntegrityLoadingUid(null);
    }
  };

  const updateIntegrityReviewStatus = async (
    uid: string,
    reviewStatus: 'unreviewed' | 'monitoring' | 'dismissed' | 'confirmed',
  ) => {
    if (!isAdmin || !user?.uid) return;
    setLoading(true);
    setMessage('');
    try {
      await updateDoc(doc(db, 'integrity_user_summaries', uid), {
        reviewStatus,
        reviewedAt: serverTimestamp(),
        reviewedBy: user.uid,
        newEventCount: 0,
      });
      setIntegritySummaries((previous) => previous.map((summary) => (
        summary.uid === uid
          ? { ...summary, reviewStatus, reviewedBy: user.uid, newEventCount: 0 }
          : summary
      )));
      setMessage('レビュー状態を更新しました。');
    } catch (error) {
      console.error(error);
      setMessage('レビュー状態の更新に失敗しました。');
    } finally {
      setLoading(false);
    }
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
      await setDoc(doc(db, 'config', 'unit_catalog'), {
        revision: increment(1),
        updatedAt: serverTimestamp(),
      }, { merge: true });
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
      const unitRef = doc(db, 'units', unitId);
      const unit = units.find(u => u.id === unitId);
      const newTotal = Math.max(0, (unit?.totalQuestions || 0) - 1);
      const deletedQuestion = unit?.questions.find((question: any) => question.id === qId);
      const currentActiveTotal = unit?.questions.filter((question: any) => question.active !== false).length || 0;
      const newActiveTotal = Math.max(0, currentActiveTotal - (deletedQuestion?.active === false ? 0 : 1));
      const batch = writeBatch(db);
      batch.delete(doc(db, 'units', unitId, 'questions', qId));
      batch.update(unitRef, {
        totalQuestions: newTotal,
        activeQuestionCount: newActiveTotal,
        questionAvailabilityRevision: increment(1),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'config', 'unit_catalog'), {
        revision: increment(1),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await batch.commit();
      
      // ローカルステートを更新
      setUnits(units.map(u => 
        u.id === unitId 
          ? {
              ...u,
              totalQuestions: newTotal,
              activeQuestionCount: newActiveTotal,
              questionAvailabilityRevision: (Number(u.questionAvailabilityRevision) || 0) + 1,
              questions: u.questions.filter((q: any) => q.id !== qId),
            }
          : u
      ));
      
      setMessage('問題を削除しました。');
    } catch (e) {
      console.error(e);
      setMessage('削除エラーが発生しました。');
    }
    setLoading(false);
  };

  const handleToggleQuestionActive = async (unitId: string, qId: string, active: boolean) => {
    const questionKey = `${unitId}/${qId}`;
    setUpdatingQuestionKeys(current => new Set(current).add(questionKey));
    setMessage('');

    try {
      const unit = units.find(candidate => candidate.id === unitId);
      const activeQuestionCount = unit?.questions.filter((question: any) => (
        question.id === qId ? active : question.active !== false
      )).length || 0;
      const batch = writeBatch(db);
      batch.update(doc(db, 'units', unitId, 'questions', qId), {
        active,
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'units', unitId), {
        activeQuestionCount,
        questionAvailabilityRevision: increment(1),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'config', 'unit_catalog'), {
        revision: increment(1),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await batch.commit();

      setUnits(current => current.map(unit => (
        unit.id === unitId
          ? {
              ...unit,
              activeQuestionCount,
              questionAvailabilityRevision: (Number(unit.questionAvailabilityRevision) || 0) + 1,
              questions: unit.questions.map((question: any) => (
                question.id === qId ? { ...question, active } : question
              )),
            }
          : unit
      )));
      setMessage(`問題を${active ? '公開' : '非公開'}にしました。`);
    } catch (e: any) {
      console.error(e);
      setMessage(`公開状態の更新に失敗しました: ${e.message || e}`);
    } finally {
      setUpdatingQuestionKeys(current => {
        const next = new Set(current);
        next.delete(questionKey);
        return next;
      });
    }
  };

  const handleToggleUnitQuestionsActive = async (unitId: string, active: boolean) => {
    setUpdatingUnitIds(current => new Set(current).add(unitId));
    setMessage('');

    try {
      const functions = getFunctions(undefined, 'us-central1');
      const setUnitQuestionsActive = httpsCallable<
        { unitId: string; active: boolean },
        { questionCount: number; activeQuestionCount: number }
      >(functions, 'setUnitQuestionsActive');
      const response = await setUnitQuestionsActive({ unitId, active });

      setUnits(current => current.map(unit => (
        unit.id === unitId
          ? {
              ...unit,
              activeQuestionCount: response.data.activeQuestionCount,
              questionAvailabilityRevision: (Number(unit.questionAvailabilityRevision) || 0) + 1,
              questions: unit.questions.map((question: any) => ({ ...question, active })),
            }
          : unit
      )));
      setMessage(`単元内の${response.data.questionCount}問をすべて${active ? '公開' : '非公開'}にしました。`);
    } catch (e: any) {
      console.error(e);
      await fetchUnits();
      setMessage(`単元の公開状態更新に失敗しました: ${e.message || e}`);
    } finally {
      setUpdatingUnitIds(current => {
        const next = new Set(current);
        next.delete(unitId);
        return next;
      });
    }
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

  const handleResetUserData = async (uid: string, displayName: string) => {
    if (!window.confirm(`⚠️ 警告: ${displayName || uid} さんの数学学習データをリセットしますか？\n\nXP、レベル、ハイスコア、進捗、記述式の挑戦状態が初期化されます。過去の演習履歴と不審操作ログは監査用として保持され、90日後に自動削除されます。`)) return;
    if (!window.confirm(`【最終確認】${displayName || uid} さんの数学学習状態を本当に初期化しますか？`)) return;

    setLoading(true);
    setMessage('ユーザーデータリセット中...');

    try {
      const resetUserLearningData = httpsCallable<
        { uid: string },
        { learningGeneration: number; deletedWrongAnswers: number; deletedWrittenAttemptLimits: number }
      >(getFunctions(undefined, 'us-central1'), 'resetUserLearningData');
      const response = await resetUserLearningData({ uid });

      // ローカルステートの更新
      setUsers(current => current.map(u => u.docId === uid ? {
        ...u,
        xp: 0,
        level: 1,
        totalScore: 0,
        icon: '📐',
        unitStats: {},
        learningGeneration: response.data.learningGeneration,
      } : u));

      setMessage(`✅ ${displayName || uid} さんの数学学習状態を初期化しました。過去履歴は監査用として保持されています。`);
    } catch (e: any) {
      console.error(e);
      setMessage(`❌ エラーが発生しました: ${e.message}`);
    }
    setLoading(false);
  };

  const handleToggleXpEarningLock = async (uid: string, displayName: string, locked: boolean) => {
    const action = locked ? '停止' : '再開';
    if (!window.confirm(`${displayName || uid} さんのXP獲得を${action}しますか？`)) return;

    setLoading(true);
    setMessage('XP獲得設定を更新中...');
    try {
      const setUserXpEarningLock = httpsCallable<
        { uid: string; locked: boolean },
        { success: boolean; locked: boolean }
      >(getFunctions(undefined, 'us-central1'), 'setUserXpEarningLock');
      await setUserXpEarningLock({ uid, locked });
      setUsers(current => current.map(candidate => (
        candidate.docId === uid ? { ...candidate, xpEarningLocked: locked } : candidate
      )));
      setMessage(`✅ ${displayName || uid} さんのXP獲得を${action}しました。`);
    } catch (error: any) {
      console.error(error);
      setMessage(`❌ XP獲得設定の更新に失敗しました: ${error.message || error}`);
    } finally {
      setLoading(false);
    }
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
          const subjectMetadata = getImportSubjectMetadata(importSubject);

          data.forEach((row) => {
            const {
              unit_id,
              question_text,
              options,
              answer_index,
              explanation,
              image_url,
              category,
              question_type,
              model_answer,
              grading_rubric,
              event_status,
              event_starts_at,
              event_ends_at,
              written_attempt_limit,
              reward_icon_id,
              reward_icon_name,
              reward_icon_image_url,
              reward_condition_type,
              reward_condition_value,
            } = row;
            if (!unit_id) return;
            const rowDrillType = question_type === 'written' || subjectMetadata.drillType === 'written' ? 'written' : 'multiple_choice';
            const writtenAttemptLimit = Math.max(2, parseInt(written_attempt_limit, 10) || 2);

            if (!unitsMap[unit_id]) {
              unitsMap[unit_id] = {
                unitDoc: {
                  id: unit_id,
                  title: `単元 ${unit_id}`,
                  subject: subjectMetadata.subject,
                  baseSubject: subjectMetadata.baseSubject,
                  mode: subjectMetadata.mode,
                  drillType: rowDrillType,
                  eventStatus: rowDrillType === 'written' ? (event_status || 'active') : null,
                  eventStartsAt: event_starts_at || null,
                  eventEndsAt: event_ends_at || null,
                  writtenAttemptLimit: rowDrillType === 'written' ? writtenAttemptLimit : null,
                  writtenXpBase: rowDrillType === 'written' ? 232 : null,
                  includeInTotalScore: rowDrillType !== 'written',
                  category: category || '1.正の数と負の数',
                  totalQuestions: 0
                },
                questions: []
              };
            }

            // IDは単元内の連番で生成（全体行番号を使うと他単元の問題数に依存し、
            // 再インポート時にIDがズレて wrongQuestionIds の追跡が壊れる）
            const localIndex = unitsMap[unit_id].questions.length;
            let iconReward = null;
            const hasRewardSetting = [
              reward_icon_id,
              reward_icon_name,
              reward_icon_image_url,
              reward_condition_type,
              reward_condition_value,
            ].some((value) => String(value ?? '').trim() !== '');
            if (hasRewardSetting) {
              const rewardValue = Number(reward_condition_value);
              if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(reward_icon_id)
                || !reward_icon_name
                || !/^\/images\/reward-icons\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(png|webp|avif)$/.test(reward_icon_image_url || '')
                || (reward_icon_image_url || '').includes('..')
                || reward_condition_type !== 'written_score_at_least'
                || !Number.isFinite(rewardValue)
                || rewardValue < 0
                || rewardValue > 100) {
                throw new Error(`${unit_id}: アイコン報酬の設定が不正です。`);
              }
              iconReward = {
                id: reward_icon_id,
                name: reward_icon_name.slice(0, 80),
                imageUrl: reward_icon_image_url,
                condition: {
                  type: reward_condition_type,
                  value: Math.round(rewardValue),
                },
              };
            }
            unitsMap[unit_id].questions.push({
              id: `q_${localIndex}`,
              order: localIndex,
              question_text: question_text || '',
              options: parseOptions(options),
              answer_index: parseInt(answer_index) || 1,
              explanation: explanation || '',
              image_url: image_url || null,
              questionType: rowDrillType,
              modelAnswer: model_answer || '',
              gradingRubric: grading_rubric ? (function(r) {
                try {
                  const parsed = JSON.parse(r);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return parseOptions(r); // 互換性のためフォールバック
                }
              })(grading_rubric) : [],
              iconReward,
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

          await setDoc(doc(db, 'config', 'unit_catalog'), {
            revision: increment(1),
            updatedAt: serverTimestamp(),
          }, { merge: true });

          localStorage.removeItem('math_units_cache_v4');
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
`unit_id,category,question_text,options,answer_index,explanation,image_url,question_type,model_answer,grading_rubric,written_attempt_limit,event_status,event_starts_at,event_ends_at,reward_icon_id,reward_icon_name,reward_icon_image_url,reward_condition_type,reward_condition_value
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

      <div className="flex space-x-2 overflow-x-auto border-b">
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
          onClick={() => setActiveTab('writtenAnalytics')}
          className={`px-4 py-2 font-medium ${activeTab === 'writtenAnalytics' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <BarChart className="inline w-4 h-4 mr-2" />
          記述式分析
        </button>
        <button
          onClick={() => setActiveTab('feedback')}
          className={`px-4 py-2 font-medium ${activeTab === 'feedback' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <MessageSquare className="inline w-4 h-4 mr-2" />
          フィードバック
        </button>
        <button
          onClick={() => setActiveTab('writtenFeedback')}
          className={`px-4 py-2 font-medium ${activeTab === 'writtenFeedback' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <MessageSquare className="inline w-4 h-4 mr-2" />
          記述採点FB
        </button>
        <button
          onClick={() => setActiveTab('notifications')}
          className={`shrink-0 px-4 py-2 font-medium ${activeTab === 'notifications' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Bell className="inline w-4 h-4 mr-2" />
          通知
        </button>
        <button
          onClick={() => setActiveTab('roles')} 
          className={`shrink-0 px-4 py-2 font-medium ${activeTab === 'roles' ? 'border-b-2 border-primary text-primary' : 'text-gray-500 hover:text-gray-700'}`}
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
          onToggleQuestionActive={handleToggleQuestionActive}
          onToggleUnitQuestionsActive={handleToggleUnitQuestionsActive}
          updatingQuestionKeys={updatingQuestionKeys}
          updatingUnitIds={updatingUnitIds}
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
          onToggleXpEarningLock={handleToggleXpEarningLock}
          onRefresh={fetchUsers}
        />
      )}
      {/* ========== TAB: SUSPICIOUS ========== */}
      {activeTab === 'suspicious' && (
        <SuspiciousTab
          summaries={integritySummaries}
          eventsByUid={integrityEventsByUid}
          scores={scores}
          suspiciousActivities={suspiciousActivities}
          loading={loading}
          loadingUid={integrityLoadingUid}
          onLoadEvents={fetchIntegrityEvents}
          onSetReviewStatus={updateIntegrityReviewStatus}
          onSetUnitForStats={setSelectedUnitForStats}
          onSwitchToAnalytics={() => { setAnalyticsAutoLoad(true); setActiveTab('analytics'); }}
          onRefresh={fetchIntegritySummaries}
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

      {activeTab === 'writtenAnalytics' && (
        <WrittenAnalyticsTab />
      )}

      {activeTab === 'feedback' && (
        <FeedbackTab
          feedbackItems={feedbackItems}
          loading={loading}
          onRefresh={fetchFeedback}
          onDeleteFeedback={handleDeleteFeedback}
        />
      )}

      {activeTab === 'writtenFeedback' && (
        <FeedbackTab
          feedbackItems={writtenFeedbackItems}
          loading={loading}
          onRefresh={fetchWrittenFeedback}
          onDeleteFeedback={handleDeleteWrittenFeedback}
        />
      )}

      {activeTab === 'notifications' && (
        <NotificationsTab />
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
          appAccessEmail={appAccessEmail}
          setAppAccessEmail={setAppAccessEmail}
          appAccessAccounts={appAccessAccounts}
          appAccessInvites={appAccessInvites}
          appAccessListLoading={appAccessListLoading}
          onFetchAppAccessList={fetchAppAccessList}
          onSetMessage={setMessage}
        />
      )}
    </div>
  );
}
